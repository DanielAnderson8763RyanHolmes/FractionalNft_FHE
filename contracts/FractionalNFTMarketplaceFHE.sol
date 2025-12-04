// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract FractionalNFTMarketplaceFHE is SepoliaConfig, ERC721 {
    struct ArtPiece {
        uint256 id;
        address creator;
        string metadataURI;
        uint256 totalShares;
        uint256 mintedShares;
        bool isActive;
    }
    
    struct EncryptedShare {
        euint32 encryptedOwner;     // Encrypted owner identifier
        euint32 encryptedPrice;     // Encrypted listing price
        euint32 encryptedFraction;  // Encrypted ownership fraction
        bool isListed;
    }
    
    struct DAOProposal {
        uint256 id;
        string description;
        euint32 encryptedVotesFor;
        euint32 encryptedVotesAgainst;
        uint256 endTime;
        bool isExecuted;
    }
    
    struct DecryptedShare {
        address owner;
        uint256 price;
        uint256 fraction;
        bool isRevealed;
    }

    uint256 public artPieceCount;
    mapping(uint256 => ArtPiece) public artPieces;
    mapping(uint256 => mapping(uint256 => EncryptedShare)) public encryptedShares; // [artPieceId][tokenId]
    mapping(uint256 => mapping(uint256 => DecryptedShare)) public decryptedShares;
    
    uint256 public proposalCount;
    mapping(uint256 => DAOProposal) public daoProposals;
    mapping(address => euint32) private encryptedVotingPower;
    
    mapping(uint256 => uint256) private requestToTokenId;
    mapping(uint256 => uint256) private requestToArtId;
    
    event ArtPieceCreated(uint256 indexed id, address indexed creator);
    event ShareMinted(uint256 indexed artId, uint256 indexed tokenId);
    event ShareListed(uint256 indexed artId, uint256 indexed tokenId);
    event ShareTraded(uint256 indexed artId, uint256 indexed tokenId);
    event ProposalCreated(uint256 indexed id);
    event ProposalExecuted(uint256 indexed id);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    
    constructor() ERC721("FractionalArtNFT", "FANFT") {}
    
    /// @notice Create a new art piece
    function createArtPiece(string memory metadataURI, uint256 totalShares) public {
        artPieceCount += 1;
        uint256 newId = artPieceCount;
        
        artPieces[newId] = ArtPiece({
            id: newId,
            creator: msg.sender,
            metadataURI: metadataURI,
            totalShares: totalShares,
            mintedShares: 0,
            isActive: true
        });
        
        emit ArtPieceCreated(newId, msg.sender);
    }
    
    /// @notice Mint fractional shares for an art piece
    function mintFractionalShares(
        uint256 artId,
        euint32 encryptedOwner,
        euint32 encryptedFraction
    ) public {
        ArtPiece storage piece = artPieces[artId];
        require(piece.isActive, "Art piece not active");
        require(piece.mintedShares < piece.totalShares, "All shares minted");
        
        uint256 tokenId = piece.mintedShares + 1;
        piece.mintedShares = tokenId;
        
        encryptedShares[artId][tokenId] = EncryptedShare({
            encryptedOwner: encryptedOwner,
            encryptedPrice: FHE.asEuint32(0),
            encryptedFraction: encryptedFraction,
            isListed: false
        });
        
        decryptedShares[artId][tokenId] = DecryptedShare({
            owner: address(0),
            price: 0,
            fraction: 0,
            isRevealed: false
        });
        
        _mint(msg.sender, tokenId);
        emit ShareMinted(artId, tokenId);
    }
    
    /// @notice List a share for sale
    function listShareForSale(
        uint256 artId,
        uint256 tokenId,
        euint32 encryptedPrice
    ) public {
        EncryptedShare storage share = encryptedShares[artId][tokenId];
        require(!share.isListed, "Share already listed");
        
        share.encryptedPrice = encryptedPrice;
        share.isListed = true;
        
        emit ShareListed(artId, tokenId);
    }
    
    /// @notice Execute a share trade
    function executeShareTrade(
        uint256 artId,
        uint256 tokenId,
        euint32 encryptedNewOwner
    ) public {
        EncryptedShare storage share = encryptedShares[artId][tokenId];
        require(share.isListed, "Share not listed");
        
        // Transfer ownership
        share.encryptedOwner = encryptedNewOwner;
        share.isListed = false;
        
        emit ShareTraded(artId, tokenId);
    }
    
    /// @notice Create a new DAO proposal
    function createDAOProposal(string memory description, uint256 votingDuration) public {
        proposalCount += 1;
        uint256 newId = proposalCount;
        
        daoProposals[newId] = DAOProposal({
            id: newId,
            description: description,
            encryptedVotesFor: FHE.asEuint32(0),
            encryptedVotesAgainst: FHE.asEuint32(0),
            endTime: block.timestamp + votingDuration,
            isExecuted: false
        });
        
        emit ProposalCreated(newId);
    }
    
    /// @notice Cast an encrypted vote
    function castVote(uint256 proposalId, ebool encryptedVote) public {
        DAOProposal storage proposal = daoProposals[proposalId];
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!proposal.isExecuted, "Proposal executed");
        
        euint32 votingPower = encryptedVotingPower[msg.sender];
        require(FHE.isInitialized(votingPower), "No voting power");
        
        proposal.encryptedVotesFor = FHE.add(
            proposal.encryptedVotesFor,
            FHE.cmux(encryptedVote, votingPower, FHE.asEuint32(0))
        );
        
        proposal.encryptedVotesAgainst = FHE.add(
            proposal.encryptedVotesAgainst,
            FHE.cmux(FHE.not(encryptedVote), votingPower, FHE.asEuint32(0))
        );
        
        emit VoteCast(proposalId, msg.sender);
    }
    
    /// @notice Execute a DAO proposal
    function executeProposal(uint256 proposalId) public {
        DAOProposal storage proposal = daoProposals[proposalId];
        require(block.timestamp >= proposal.endTime, "Voting ongoing");
        require(!proposal.isExecuted, "Already executed");
        
        // In real implementation, execute proposal logic
        proposal.isExecuted = true;
        
        emit ProposalExecuted(proposalId);
    }
    
    /// @notice Request decryption of share ownership
    function requestShareDecryption(uint256 artId, uint256 tokenId) public {
        EncryptedShare storage share = encryptedShares[artId][tokenId];
        require(!decryptedShares[artId][tokenId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(share.encryptedOwner);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptShareOwner.selector);
        requestToTokenId[reqId] = tokenId;
        requestToArtId[reqId] = artId;
    }
    
    /// @notice Process decrypted share owner
    function decryptShareOwner(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 tokenId = requestToTokenId[requestId];
        uint256 artId = requestToArtId[requestId];
        require(tokenId != 0 && artId != 0, "Invalid request");
        
        DecryptedShare storage dShare = decryptedShares[artId][tokenId];
        require(!dShare.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        address owner = abi.decode(cleartexts, (address));
        dShare.owner = owner;
        dShare.isRevealed = true;
    }
    
    /// @notice Request decryption of vote results
    function requestVoteResultDecryption(uint256 proposalId) public {
        DAOProposal storage proposal = daoProposals[proposalId];
        require(proposal.isExecuted, "Proposal not executed");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(proposal.encryptedVotesFor);
        ciphertexts[1] = FHE.toBytes32(proposal.encryptedVotesAgainst);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptVoteResults.selector);
        requestToTokenId[reqId] = proposalId;
    }
    
    /// @notice Process decrypted vote results
    function decryptVoteResults(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 proposalId = requestToTokenId[requestId];
        require(proposalId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 votesFor, uint32 votesAgainst) = abi.decode(cleartexts, (uint32, uint32));
        // Handle decrypted vote results
    }
    
    /// @notice Assign encrypted voting power
    function assignVotingPower(address voter, euint32 power) public {
        encryptedVotingPower[voter] = power;
    }
    
    /// @notice Calculate ownership percentage
    function calculateOwnershipPercentage(uint256 artId, uint256 tokenId) public view returns (euint32) {
        ArtPiece storage piece = artPieces[artId];
        EncryptedShare storage share = encryptedShares[artId][tokenId];
        
        return FHE.div(
            FHE.mul(share.encryptedFraction, FHE.asEuint32(10000)), 
            FHE.asEuint32(uint32(piece.totalShares))
        );
    }
    
    /// @notice Get art piece details
    function getArtPiece(uint256 artId) public view returns (
        address creator,
        string memory metadataURI,
        uint256 totalShares,
        uint256 mintedShares,
        bool isActive
    ) {
        ArtPiece storage piece = artPieces[artId];
        return (
            piece.creator,
            piece.metadataURI,
            piece.totalShares,
            piece.mintedShares,
            piece.isActive
        );
    }
    
    /// @notice Get encrypted share details
    function getEncryptedShare(uint256 artId, uint256 tokenId) public view returns (
        euint32 encryptedOwner,
        euint32 encryptedPrice,
        euint32 encryptedFraction,
        bool isListed
    ) {
        EncryptedShare storage share = encryptedShares[artId][tokenId];
        return (
            share.encryptedOwner,
            share.encryptedPrice,
            share.encryptedFraction,
            share.isListed
        );
    }
    
    /// @notice Get decrypted share details
    function getDecryptedShare(uint256 artId, uint256 tokenId) public view returns (
        address owner,
        uint256 price,
        uint256 fraction,
        bool isRevealed
    ) {
        DecryptedShare storage share = decryptedShares[artId][tokenId];
        return (
            share.owner,
            share.price,
            share.fraction,
            share.isRevealed
        );
    }
}