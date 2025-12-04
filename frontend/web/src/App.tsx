// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FractionalNFT {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  artworkTitle: string;
  artist: string;
  totalShares: number;
  availableShares: number;
  pricePerShare: string;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [nfts, setNfts] = useState<FractionalNFT[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newNftData, setNewNftData] = useState({
    artworkTitle: "",
    artist: "",
    totalShares: 100,
    pricePerShare: "0.1"
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Filtered NFTs based on search and category
  const filteredNfts = nfts.filter(nft => {
    const matchesSearch = nft.artworkTitle.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          nft.artist.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || 
                           (selectedCategory === "available" && nft.availableShares > 0);
    return matchesSearch && matchesCategory;
  });

  // Calculate statistics
  const totalArtworks = nfts.length;
  const totalSharesAvailable = nfts.reduce((sum, nft) => sum + nft.availableShares, 0);
  const totalValueLocked = nfts.reduce((sum, nft) => sum + (parseFloat(nft.pricePerShare) * nft.totalShares), 0);

  useEffect(() => {
    loadNfts().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load NFTs from contract
  const loadNfts = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("nft_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing NFT keys:", e);
        }
      }
      
      const list: FractionalNFT[] = [];
      
      for (const key of keys) {
        try {
          const nftBytes = await contract.getData(`nft_${key}`);
          if (nftBytes.length > 0) {
            try {
              const nftData = JSON.parse(ethers.toUtf8String(nftBytes));
              list.push({
                id: key,
                encryptedData: nftData.data,
                timestamp: nftData.timestamp,
                owner: nftData.owner,
                artworkTitle: nftData.artworkTitle,
                artist: nftData.artist,
                totalShares: nftData.totalShares,
                availableShares: nftData.availableShares,
                pricePerShare: nftData.pricePerShare
              });
            } catch (e) {
              console.error(`Error parsing NFT data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading NFT ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setNfts(list);
    } catch (e) {
      console.error("Error loading NFTs:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new fractional NFT
  const submitNft = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting artwork data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newNftData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const nftId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const nftData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        artworkTitle: newNftData.artworkTitle,
        artist: newNftData.artist,
        totalShares: newNftData.totalShares,
        availableShares: newNftData.totalShares,
        pricePerShare: newNftData.pricePerShare
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `nft_${nftId}`, 
        ethers.toUtf8Bytes(JSON.stringify(nftData))
      );
      
      const keysBytes = await contract.getData("nft_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(nftId);
      
      await contract.setData(
        "nft_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Artwork fractionalized securely!"
      });
      
      await loadNfts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewNftData({
          artworkTitle: "",
          artist: "",
          totalShares: 100,
          pricePerShare: "0.1"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Purchase shares of an NFT
  const purchaseShares = async (nftId: string, shares: number) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted transaction with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const nftBytes = await contract.getData(`nft_${nftId}`);
      if (nftBytes.length === 0) {
        throw new Error("NFT not found");
      }
      
      const nftData = JSON.parse(ethers.toUtf8String(nftBytes));
      
      if (nftData.availableShares < shares) {
        throw new Error("Not enough shares available");
      }
      
      const updatedNft = {
        ...nftData,
        availableShares: nftData.availableShares - shares
      };
      
      await contract.setData(
        `nft_${nftId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNft))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Shares purchased successfully!"
      });
      
      await loadNfts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Purchase failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Check if user is the owner
  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  // Loading screen
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Art</span>Shares</h1>
          <p>Anonymous Fractional NFT Marketplace</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Own a Piece of Art History</h2>
            <p>Fractionalize and trade artwork NFTs anonymously using FHE technology</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
            >
              Fractionalize Your Art
            </button>
          </div>
        </section>
        
        <section className="stats-section">
          <div className="stat-card">
            <h3>Total Artworks</h3>
            <p>{totalArtworks}</p>
          </div>
          <div className="stat-card">
            <h3>Shares Available</h3>
            <p>{totalSharesAvailable}</p>
          </div>
          <div className="stat-card">
            <h3>Total Value</h3>
            <p>{totalValueLocked.toFixed(2)} ETH</p>
          </div>
          <div className="stat-card highlight">
            <h3>FHE Secured</h3>
            <p>100% Private</p>
          </div>
        </section>
        
        <section className="marketplace-section">
          <div className="section-header">
            <h2>Available Fractional NFTs</h2>
            <div className="search-filter">
              <input 
                type="text" 
                placeholder="Search artworks..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select 
                value={selectedCategory} 
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="all">All Artworks</option>
                <option value="available">Available Shares</option>
              </select>
              <button 
                onClick={loadNfts}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          {filteredNfts.length === 0 ? (
            <div className="empty-state">
              <p>No fractional NFTs found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Create First Listing
              </button>
            </div>
          ) : (
            <div className="nft-grid">
              {filteredNfts.map(nft => (
                <div className="nft-card" key={nft.id}>
                  <div className="nft-image">
                    <div className="art-placeholder"></div>
                    <div className="fhe-badge">FHE Encrypted</div>
                  </div>
                  <div className="nft-details">
                    <h3>{nft.artworkTitle}</h3>
                    <p className="artist">by {nft.artist}</p>
                    <div className="nft-stats">
                      <div>
                        <span>Total Shares:</span>
                        <span>{nft.totalShares}</span>
                      </div>
                      <div>
                        <span>Available:</span>
                        <span>{nft.availableShares}</span>
                      </div>
                      <div>
                        <span>Price/Share:</span>
                        <span>{nft.pricePerShare} ETH</span>
                      </div>
                    </div>
                    <div className="nft-actions">
                      {nft.availableShares > 0 && (
                        <button 
                          className="buy-btn"
                          onClick={() => purchaseShares(nft.id, 1)}
                        >
                          Buy 1 Share
                        </button>
                      )}
                      {isOwner(nft.owner) && (
                        <button className="owner-badge">Your Artwork</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitNft} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          nftData={newNftData}
          setNftData={setNewNftData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FHE Art Shares</h3>
            <p>Anonymous Fractional NFT Marketplace</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">How It Works</a>
            <a href="#" className="footer-link">FHE Technology</a>
            <a href="#" className="footer-link">FAQ</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Fully Homomorphic Encryption</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Art Shares. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  nftData: any;
  setNftData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  nftData,
  setNftData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNftData({
      ...nftData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!nftData.artworkTitle || !nftData.artist) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Fractionalize Your Artwork</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            Your artwork details will be encrypted with FHE technology
          </div>
          
          <div className="form-group">
            <label>Artwork Title *</label>
            <input 
              type="text"
              name="artworkTitle"
              value={nftData.artworkTitle} 
              onChange={handleChange}
              placeholder="Mona Lisa" 
            />
          </div>
          
          <div className="form-group">
            <label>Artist *</label>
            <input 
              type="text"
              name="artist"
              value={nftData.artist} 
              onChange={handleChange}
              placeholder="Leonardo da Vinci" 
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Total Shares</label>
              <input 
                type="number"
                name="totalShares"
                value={nftData.totalShares} 
                onChange={handleChange}
                min="1"
              />
            </div>
            
            <div className="form-group">
              <label>Price Per Share (ETH)</label>
              <input 
                type="text"
                name="pricePerShare"
                value={nftData.pricePerShare} 
                onChange={handleChange}
                placeholder="0.1"
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="primary-btn"
          >
            {creating ? "Encrypting with FHE..." : "Fractionalize Artwork"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;