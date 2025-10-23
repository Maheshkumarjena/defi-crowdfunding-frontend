'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Connection, PublicKey, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, web3, utils, Idl, BN } from '@project-serum/anchor';
import idl from '.././idl.js';

interface SolanaWindow extends Window {
  solana?: {
    isPhantom?: boolean;
    isConnected?: boolean;
    connect?: () => Promise<{ publicKey: { toString: () => string } }>;
    publicKey?: { toString: () => string };
  };
}

interface CampaignData {
  admin: PublicKey;
  name: string;
  description: string;
  amountDonated: BN;
}

interface CampaignAccount {
  publicKey: PublicKey;
  account: CampaignData;
}

// Custom hook for wallet connection
function useWalletConnection() {
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const checkIfWalletIsConnected = useCallback(async () => {
    try {
      if (typeof window !== 'undefined') {
        const { solana } = window as SolanaWindow;
        if (solana?.isPhantom) {
          if (solana.isConnected && solana.publicKey) {
            const pubKey = solana.publicKey.toString();
            setWalletStatus('Phantom wallet found and connected!');
            setIsWalletConnected(true);
            setPublicKey(pubKey);
          } else {
            setWalletStatus('Phantom wallet found but not connected.');
            setIsWalletConnected(false);
          }
        } else {
          setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻');
          setIsWalletConnected(false);
        }
      }
    } catch (error) {
      console.error('Error checking wallet connection:', error);
      setWalletStatus('Error checking wallet connection. Please try again.');
      setIsWalletConnected(false);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      const { solana } = window as SolanaWindow;
      if (solana?.isPhantom) {
        const response = await solana.connect?.();
        const pubKey = response?.publicKey.toString();
        setWalletStatus('Wallet connected successfully!');
        setIsWalletConnected(true);
        setPublicKey(pubKey || null);
        return pubKey;
      } else {
        setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻');
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setWalletStatus('Error connecting wallet: Please try again.');
      throw error;
    }
  }, []);

  useEffect(() => {
    checkIfWalletIsConnected();
    
    const onLoad = () => checkIfWalletIsConnected();
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, [checkIfWalletIsConnected]);

  return {
    walletStatus,
    isWalletConnected,
    publicKey,
    connectWallet,
    setWalletStatus
  };
}

// Custom hook for campaigns
function useCampaigns() {
  const [campaigns, setCampaigns] = useState<CampaignAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  return {
    campaigns,
    setCampaigns,
    loading,
    setLoading
  };
}

// Error Boundary Component
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-500 rounded-lg p-5 text-center text-red-200 my-5">
        <h3 className="text-red-300 mb-2 font-bold">Error</h3>
        <p>{error}</p>
        <button 
          onClick={() => setError(null)}
          className="mt-3 px-4 py-2 bg-red-500 text-gray-900 rounded font-bold hover:bg-red-400 transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

// Proper IDL type handling
interface CustomIdl {
  address: string;
  metadata: {
    name: string;
    version: string;
    spec: string;
    description: string;
  };
  instructions: any[];
  accounts: any[];
  types: any[];
  events?: any[];
  errors?: any[];
  constants?: any[];
}

// Convert the custom IDL to Anchor's expected Idl format
const processIdl = (rawIdl: CustomIdl): Idl => {
  return {
    version: rawIdl.metadata?.version || "0.1.0",
    name: rawIdl.metadata?.name || "campaign_program",
    instructions: rawIdl.instructions || [],
    accounts: rawIdl.accounts || [],
    types: rawIdl.types || [],
    events: rawIdl.events || [],
    errors: rawIdl.errors || [],
    constants: rawIdl.constants || [],
  };
};

// Process the IDL data
const idlData = processIdl(idl as CustomIdl);
const FALLBACK_PROGRAM_ID = 'GgEMjntpZKxcUxdkGkJzqkufYzdoSmezRJWHVTk3dr2h';
const network = "https://api.devnet.solana.com";
const opts = {
  preflightCommitment: "processed" as web3.Commitment,
};
const { SystemProgram } = web3;

let programID: PublicKey | null = null;
try {
  if (idl.address && typeof idl.address === 'string') {
    programID = new PublicKey(idl.address);
  }
} catch (e) {
  console.warn('Could not construct programID:', e);
}

// Memoized utility functions
const formatSol = (lamports: BN): string => {
  return (lamports.toNumber() / LAMPORTS_PER_SOL).toFixed(4);
};

const truncatePublicKey = (publicKey: string): string => {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
};

export default function Home() {
  const { walletStatus, isWalletConnected, publicKey, connectWallet, setWalletStatus } = useWalletConnection();
  const { campaigns, setCampaigns, loading, setLoading } = useCampaigns();
  
  const [creatingCampaign, setCreatingCampaign] = useState<boolean>(false);
  const [donatingCampaign, setDonatingCampaign] = useState<string | null>(null);
  const [donationAmount, setDonationAmount] = useState<string>('0.1');
  const [campaignName, setCampaignName] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');

  // Memoized provider function
  const getProvider = useCallback(() => {
    const connection = new Connection(network, opts.preflightCommitment);
    const win = window as unknown as SolanaWindow;
    if (!win.solana?.isPhantom) {
      throw new Error('Phantom wallet not available. Please install Phantom Wallet.');
    }
    if (!win.solana.isConnected || !win.solana.publicKey) {
      throw new Error('Wallet is not connected. Please connect the wallet first.');
    }
    return new AnchorProvider(connection, win.solana as any, {
      preflightCommitment: opts.preflightCommitment,
    });
  }, []);

  // Memoized balance check
  const ensureBalance = useCallback(async (provider: AnchorProvider, minLamports: number) => {
    try {
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      if (balance < minLamports) {
        const sig = await provider.connection.requestAirdrop(provider.wallet.publicKey, minLamports);
        await provider.connection.confirmTransaction(sig, 'confirmed' as web3.Commitment);
        await new Promise((res) => setTimeout(res, 1000));
      }
    } catch (e) {
      console.warn('Airdrop/ensure balance failed:', e);
    }
  }, []);

  // Optimized campaigns fetch
  const getCampaigns = useCallback(async () => {
    if (!isWalletConnected) return;
    
    setLoading(true);
    try {
      const connection = new Connection(network, opts.preflightCommitment);
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      const program = new Program(idlData, runtimeProgramID, provider);
      
      const campaignAccounts = await connection.getProgramAccounts(runtimeProgramID);
      
      const campaignsData = await Promise.all(
        campaignAccounts.map(async (campaignAccount) => {
          try {
            const account = await program.account.campaign.fetch(campaignAccount.pubkey);
            return {
              publicKey: campaignAccount.pubkey,
              account: account as CampaignData
            };
          } catch (error) {
            console.warn('Error fetching campaign account:', campaignAccount.pubkey.toString(), error);
            return null;
          }
        })
      );

      setCampaigns(campaignsData.filter(Boolean) as CampaignAccount[]);
    } catch (err) {
      console.error('Error fetching campaign accounts:', err);
      setWalletStatus('Error fetching campaigns: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isWalletConnected, getProvider, setLoading, setCampaigns, setWalletStatus]);

  // Optimized campaign creation
  const createCampaign = useCallback(async () => {
    if (!isWalletConnected || !publicKey || !campaignName.trim()) {
      setWalletStatus(!campaignName.trim() ? 'Please enter a campaign name' : 'Wallet is not connected');
      return;
    }
    
    setCreatingCampaign(true);
    try {
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      const program = new Program(idlData, runtimeProgramID, provider);

      const [campaign] = PublicKey.findProgramAddressSync(
        [utils.bytes.utf8.encode("campaign"), provider.wallet.publicKey.toBuffer()],
        runtimeProgramID
      );

      // Check balance
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      const minBalance = 0.05 * LAMPORTS_PER_SOL;
      if (balance < minBalance) {
        setWalletStatus(`Insufficient balance. You have ${balance / LAMPORTS_PER_SOL} SOL but need at least 0.05 SOL.`);
        return;
      }

      const instruction = await program.methods
        .create(campaignName, campaignDescription || "No description provided")
        .accounts({
          campaign: campaign,
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const transaction = new Transaction().add(instruction);
      const latestBlockhash = await provider.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = provider.wallet.publicKey;

      const signature = await provider.sendAndConfirm(transaction, [], {
        commitment: 'confirmed',
        skipPreflight: true,
      });

      setWalletStatus('Campaign created successfully!');
      setCampaignName('');
      setCampaignDescription('');
      await getCampaigns();
      
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      if (error?.logs?.join('').includes('ConstraintSeeds')) {
        setWalletStatus('Error: Program seed mismatch.');
      } else if (error?.message?.includes('User rejected')) {
        setWalletStatus('Transaction cancelled by user.');
      } else {
        setWalletStatus('Error creating campaign: ' + error.message);
      }
    } finally {
      setCreatingCampaign(false);
    }
  }, [isWalletConnected, publicKey, campaignName, campaignDescription, getProvider, getCampaigns, setWalletStatus]);

  // Optimized donation function
  const donateToCampaign = useCallback(async (campaignPubkey: PublicKey) => {
    if (!isWalletConnected || !publicKey) {
      setWalletStatus('Wallet is not connected');
      return;
    }

    const amount = parseFloat(donationAmount);
    if (isNaN(amount) || amount <= 0) {
      setWalletStatus('Please enter a valid donation amount');
      return;
    }

    setDonatingCampaign(campaignPubkey.toString());
    try {
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      const program = new Program(idlData, runtimeProgramID, provider);

      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      
      if (balance < lamports) {
        throw new Error(`Insufficient balance. You have ${balance / LAMPORTS_PER_SOL} SOL but trying to donate ${amount} SOL`);
      }

      const instruction = await program.methods
        .donate(new BN(lamports))
        .accounts({
          campaign: campaignPubkey,
          user: provider.wallet.publicKey,
          system_program: SystemProgram.programId,
        })
        .instruction();

      const transaction = new Transaction().add(instruction);
      
      // Ensure accounts are writable
      if (transaction.instructions.length > 0) {
        transaction.instructions[0].keys = [
          { pubkey: campaignPubkey, isSigner: false, isWritable: true },
          { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ];
      }

      const latestBlockhash = await provider.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = provider.wallet.publicKey;

      const signature = await provider.sendAndConfirm(transaction, [], {
        commitment: 'confirmed',
        skipPreflight: true,
      });

      setWalletStatus(`Successfully donated ${amount} SOL to campaign!`);
      await getCampaigns();
      
    } catch (error: any) {
      console.error('Error donating to campaign:', error);
      if (error?.message?.includes('User rejected')) {
        setWalletStatus('Donation cancelled by user.');
      } else {
        setWalletStatus('Error donating to campaign: ' + error.message);
      }
    } finally {
      setDonatingCampaign(null);
      setDonationAmount('0.1');
    }
  }, [isWalletConnected, publicKey, donationAmount, getProvider, getCampaigns, setWalletStatus]);

  // Memoized connected container
  const renderConnectedContainer = useMemo(() => {
    const CampaignForm = () => (
      <div className="bg-gray-800 rounded-xl p-6 mb-6 border border-gray-700 shadow-lg">
        <h3 className="text-white text-xl font-bold mb-4">Create New Campaign</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-gray-300 mb-2 font-semibold">Campaign Name *</label>
            <input
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Enter unique campaign name"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2 font-semibold">Description</label>
            <textarea
              value={campaignDescription}
              onChange={(e) => setCampaignDescription(e.target.value)}
              placeholder="Enter campaign description"
              rows={3}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-vertical"
            />
          </div>
          <button
            onClick={createCampaign}
            disabled={creatingCampaign || !campaignName.trim()}
            className="w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg"
          >
            {creatingCampaign ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating Campaign...
              </span>
            ) : (
              'Create Campaign'
            )}
          </button>
        </div>
      </div>
    );

    const CampaignCard = ({ campaign, index }: { campaign: CampaignAccount; index: number }) => (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg hover:shadow-2xl transition-all duration-300 hover:border-blue-500 hover:transform hover:-translate-y-2">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-white text-lg font-bold flex-1 mr-2">{campaign.account.name}</h3>
          <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-bold shadow-lg">#{index + 1}</span>
        </div>
        
        <p className="text-gray-300 mb-4 leading-relaxed">{campaign.account.description}</p>
        
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="text-xs text-gray-400 mb-1">Amount Donated</div>
            <div className="text-lg font-bold text-green-400">{formatSol(campaign.account.amountDonated)} SOL</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-1">Admin</div>
            <div className="text-sm text-gray-300 font-mono">{truncatePublicKey(campaign.account.admin.toString())}</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={donationAmount}
              onChange={(e) => setDonationAmount(e.target.value)}
              className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder="0.1"
            />
            <span className="px-3 py-2 bg-gray-700 text-gray-300 rounded text-sm font-semibold">SOL</span>
          </div>
          <button
            onClick={() => donateToCampaign(campaign.publicKey)}
            disabled={donatingCampaign === campaign.publicKey.toString()}
            className="w-full py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed shadow-lg"
          >
            {donatingCampaign === campaign.publicKey.toString() ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Donating...
              </span>
            ) : (
              `Donate ${donationAmount} SOL`
            )}
          </button>
        </div>

        <div className="mt-4 text-xs text-gray-500 font-mono bg-gray-900 p-2 rounded border border-gray-700 break-all">
          {campaign.publicKey.toString()}
        </div>
      </div>
    );

    const CampaignsGrid = () => {
      if (loading) {
        return <div className="text-center py-12 text-gray-400"><p>Loading campaigns...</p></div>;
      }
      
      if (campaigns.length === 0) {
        return (
          <div className="text-center py-12 bg-gray-800 rounded-xl border-2 border-dashed border-gray-600">
            <p className="text-gray-400 text-lg">No campaigns found. Create your first campaign!</p>
          </div>
        );
      }

      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign, index) => (
            <CampaignCard key={campaign.publicKey.toString()} campaign={campaign} index={index} />
          ))}
        </div>
      );
    };

    return (
      <div className="mt-5">
        <CampaignForm />
        
        <div className="flex flex-wrap gap-4 justify-center mb-6">
          <button
            onClick={getCampaigns}
            disabled={loading}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed shadow-lg"
          >
            {loading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading...
              </span>
            ) : (
              'Refresh Campaigns'
            )}
          </button>
        </div>

        <div className="mt-8">
          <h2 className="text-2xl font-bold text-white mb-6 pb-4 border-b border-gray-700">
            Campaigns ({campaigns.length})
          </h2>
          <CampaignsGrid />
        </div>
      </div>
    );
  }, [campaignName, campaignDescription, creatingCampaign, donationAmount, donatingCampaign, campaigns, loading, createCampaign, donateToCampaign, getCampaigns]);

  const renderNotConnectedContainer = useMemo(() => (
    <div className="text-center py-12 px-4">
      <div className="bg-gray-800 rounded-2xl p-8 md:p-12 border-2 border-dashed border-gray-600 shadow-2xl max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">Connect Your Wallet to Get Started</h2>
        <p className="text-gray-400 mb-8 text-lg">Connect your Phantom wallet to create campaigns and support creators on Solana</p>
        <button
          onClick={connectWallet}
          className="px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-2xl text-lg"
        >
          Connect to Phantom Wallet
        </button>
      </div>
    </div>
  ), [connectWallet]);

  const statusColor = useMemo(() => {
    if (walletStatus?.includes('Error')) return 'bg-red-900/30 border border-red-500/50 text-red-300';
    if (walletStatus?.includes('success')) return 'bg-green-900/30 border border-green-500/50 text-green-300';
    return 'bg-blue-900/30 border border-blue-500/50 text-blue-300';
  }, [walletStatus]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-3xl p-6 md:p-8 shadow-2xl border border-gray-700/50">
            <header className="text-center mb-8 pb-8 border-b border-gray-700/50">
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-green-400 bg-clip-text text-transparent mb-4">
                Solana Campaign Platform
              </h1>
              <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto">
                Create and support amazing projects on the Solana blockchain
              </p>
            </header>

            {walletStatus && (
              <div className={`p-4 mb-6 rounded-xl text-center font-semibold shadow-lg ${statusColor}`}>
                {walletStatus}
              </div>
            )}

            {isWalletConnected && publicKey && (
              <div className="bg-gray-700/30 rounded-xl p-4 mb-6 border border-gray-600/50 shadow-lg">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-300 font-semibold">Connected Public Key:</span>
                    <span className="font-mono bg-gray-900 px-3 py-1 rounded-lg text-gray-300 text-sm border border-gray-600">
                      {truncatePublicKey(publicKey)}
                    </span>
                  </div>
                  <div className="flex items-center text-green-400 font-semibold">
                    <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                    Connected
                  </div>
                </div>
              </div>
            )}

            {isWalletConnected ? renderConnectedContainer : renderNotConnectedContainer}

            <footer className="mt-12 pt-8 border-t border-gray-700/50 text-center text-gray-500 text-sm">
              <p>Check the browser console for debug logs. Built with Next.js, Solana, and Anchor.</p>
            </footer>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}