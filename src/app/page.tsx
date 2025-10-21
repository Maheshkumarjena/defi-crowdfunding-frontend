'use client';

import { useEffect, useState } from 'react';
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

// Define TypeScript interface for Campaign data
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

const idlData: Idl = idl;
console.log('IDL data loaded:', JSON.stringify(idlData, null, 2));
let programID: PublicKey | null = null;

try {
  if (idlData?.address && typeof idlData.address === 'string') {
    programID = new PublicKey(idlData.address);
    console.log('Program ID initialized:', programID.toString());
  } else {
    console.warn('IDL address is missing or invalid');
  }
  if (!idlData.instructions || !idlData.accounts || !idlData.types) {
    throw new Error('Invalid IDL structure: Missing instructions, accounts, or types');
  }
} catch (e) {
  console.warn('Could not construct programID or validate IDL:', e);
}

const FALLBACK_PROGRAM_ID = 'GgEMjntpZKxcUxdkGkJzqkufYzdoSmezRJWHVTk3dr2h';
const network = "https://api.devnet.solana.com";
const opts = {
  preflightCommitment: "processed" as web3.Commitment,
};

const { SystemProgram } = web3;

export default function Home() {
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [creatingCampaign, setCreatingCampaign] = useState<boolean>(false);
  const [donatingCampaign, setDonatingCampaign] = useState<string | null>(null);
  const [donationAmount, setDonationAmount] = useState<string>('0.1');

  // Campaign creation form state
  const [campaignName, setCampaignName] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');

  console.log('Home component rendered');

  const getProvider = () => {
    const connection = new Connection(network, opts.preflightCommitment);
    const win = window as unknown as SolanaWindow;
    if (!win.solana || !win.solana.isPhantom) {
      throw new Error('Phantom wallet not available. Please install Phantom Wallet.');
    }
    if (!win.solana.isConnected || !win.solana.publicKey) {
      throw new Error('Wallet is not connected. Please connect the wallet first.');
    }
    const provider = new AnchorProvider(connection, win.solana as any, {
      preflightCommitment: opts.preflightCommitment,
    });
    console.log('Provider created, wallet public key:', provider.wallet.publicKey.toString());
    return provider;
  };

  const ensureBalance = async (provider: AnchorProvider, minLamports: number) => {
    try {
      const conn = provider.connection;
      const pubkey = provider.wallet.publicKey;
      const balance = await conn.getBalance(pubkey);
      console.log('Current wallet balance (lamports):', balance);
      if (balance < minLamports) {
        console.log(`Balance below threshold. Requesting airdrop of ${minLamports} lamports...`);
        const sig = await conn.requestAirdrop(pubkey, minLamports);
        await conn.confirmTransaction(sig, 'confirmed' as web3.Commitment);
        await new Promise((res) => setTimeout(res, 1000));
        const newBal = await conn.getBalance(pubkey);
        console.log('Airdrop complete. New balance (lamports):', newBal);
      }
    } catch (e) {
      console.warn('Airdrop/ensure balance failed:', e);
    }
  };

  const connectWallet = async () => {
    try {
      if (typeof window !== 'undefined') {
        const { solana } = window as SolanaWindow;
        if (solana && solana.isPhantom) {
          const response = await solana.connect?.();
          const pubKey = response?.publicKey.toString();
          setWalletStatus('Wallet connected successfully!');
          setIsWalletConnected(true);
          setPublicKey(pubKey || null);
          console.log('Wallet connected, public key:', pubKey);
          await getCampaigns();
        } else {
          setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻');
          console.log('Phantom wallet not found for connection');
        }
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setWalletStatus('Error connecting wallet: Please try again.');
    }
  };

  // Enhanced function to get all campaigns
  const getCampaigns = async () => {
    if (!isWalletConnected) return;
    
    setLoading(true);
    try {
      const connection = new Connection(network, opts.preflightCommitment);
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      
      if (!runtimeProgramID) {
        throw new Error('Program ID is not available. Please check idl.js.');
      }
      
      const program = new Program(idlData, runtimeProgramID, provider);
      
      // Get all program accounts
      const campaignAccounts = await connection.getProgramAccounts(runtimeProgramID);
      console.log(`Found ${campaignAccounts.length} campaign accounts`);
      
      // Fetch and process each campaign account
      const campaignsData: CampaignAccount[] = [];
      
      for (const campaignAccount of campaignAccounts) {
        try {
          const account = await program.account.campaign.fetch(campaignAccount.pubkey);
          console.log('Campaign account:', campaignAccount.pubkey.toString(), account);
          
          campaignsData.push({
            publicKey: campaignAccount.pubkey,
            account: account as CampaignData
          });
        } catch (error) {
          console.warn('Error fetching campaign account:', campaignAccount.pubkey.toString(), error);
        }
      }
      
      setCampaigns(campaignsData);
      console.log('All campaign accounts processed');
      
    } catch (err) {
      console.error('Error fetching campaign accounts:', err);
      setWalletStatus('Error fetching campaigns: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Enhanced campaign creation with unique PDA
  const createCampaign = async () => {
    try {
      if (!isWalletConnected || !publicKey) {
        throw new Error('Wallet is not connected. Please connect the wallet first.');
      }
      
      if (!campaignName.trim()) {
        setWalletStatus('Please enter a campaign name');
        return;
      }
      
      if (!idlData || !idlData.instructions || !idlData.accounts || !idlData.types) {
        throw new Error('Invalid IDL data. Please check idl.js.');
      }
      
      setCreatingCampaign(true);
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      
      if (!runtimeProgramID) {
        throw new Error('Program ID is not available. Please check idl.js.');
      }
      
      const program = new Program(idlData, runtimeProgramID, provider);

      // Generate unique PDA using campaign name and timestamp
      const [campaign] = await PublicKey.findProgramAddress(
        [
          utils.bytes.utf8.encode("CAMPAIGN_DEMO"),
          provider.wallet.publicKey.toBuffer(),
          utils.bytes.utf8.encode(campaignName.trim()),
          utils.bytes.utf8.encode(Date.now().toString()),
        ],
        runtimeProgramID
      );

      // Check if campaign already exists
      const campaignAccount = await program.account.campaign.fetchNullable(campaign);
      if (campaignAccount) {
        console.log('Campaign already exists:', campaign.toString());
        setWalletStatus('Campaign already exists! Please try a different name.');
        setCreatingCampaign(false);
        return;
      }

      // Ensure wallet has enough balance
      const thresholdLamports = Math.floor(0.1 * LAMPORTS_PER_SOL);
      await ensureBalance(provider, thresholdLamports);

      // Create instruction
      const instruction = await program.methods
        .create(campaignName, campaignDescription || "No description provided")
        .accounts({
          campaign: campaign,
          user: provider.wallet.publicKey,
          system_program: SystemProgram.programId,
        })
        .instruction();

      // Create transaction
      const transaction = new Transaction();
      transaction.add(instruction);

      // Set account metadata
      transaction.instructions[0].keys = [
        { pubkey: campaign, isSigner: false, isWritable: true },
        { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      // Simulate transaction
      const latestBlockhash = await provider.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = provider.wallet.publicKey;

      const simulation = await provider.connection.simulateTransaction(transaction);
      console.log('Simulation result:', JSON.stringify(simulation, null, 2));

      // Send transaction with retry logic
      const maxAttempts = 4;
      let attempt = 0;
      let lastErr: any = null;
      
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          const signature = await provider.sendAndConfirm(transaction, [], {
            commitment: 'confirmed',
            skipPreflight: false,
          });
          console.log('Transaction successful, signature:', signature);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = (e as any)?.message || '';
          console.warn(`Attempt ${attempt} failed:`, msg);
          if (msg.includes('Blockhash not found') || msg.includes('blockhash expired')) {
            const latest = await provider.connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = latest.blockhash;
            await new Promise((res) => setTimeout(res, 800 * attempt));
            continue;
          }
          break;
        }
      }
      
      if (lastErr) throw lastErr;
      
      console.log("Campaign created with address:", campaign.toString());
      setWalletStatus('Campaign created successfully!');
      
      // Clear form and refresh campaigns
      setCampaignName('');
      setCampaignDescription('');
      await getCampaigns();
      
    } catch (error) {
      console.error('Error creating campaign:', error);
      const anyErr = error as any;
      const isDeclaredMismatch =
        anyErr?.error?.code === 4100 ||
        (anyErr?.name === 'AnchorError' && (anyErr?.error?.name === 'DeclaredProgramIdMismatch' || (anyErr?.message || '').includes('DeclaredProgramIdMismatch')));
      
      if (isDeclaredMismatch) {
        setWalletStatus('Error creating campaign: DeclaredProgramIdMismatch. Check `src/idl.js` address or use the correct program id.');
      } else if ((anyErr?.message || '').includes('User rejected') || (anyErr?.message || '').includes('User rejected the request')) {
        setWalletStatus('Transaction cancelled by user. Please approve the transaction in your wallet.');
      } else {
        setWalletStatus('Error creating campaign: ' + (error as Error).message);
      }
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Donate to campaign function
  const donateToCampaign = async (campaignPubkey: PublicKey) => {
    try {
      if (!isWalletConnected || !publicKey) {
        throw new Error('Wallet is not connected. Please connect the wallet first.');
      }

      const amount = parseFloat(donationAmount);
      if (isNaN(amount) || amount <= 0) {
        setWalletStatus('Please enter a valid donation amount');
        return;
      }

      setDonatingCampaign(campaignPubkey.toString());
      const provider = getProvider();
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID);
      
      if (!runtimeProgramID) {
        throw new Error('Program ID is not available. Please check idl.js.');
      }
      
      const program = new Program(idlData, runtimeProgramID, provider);

      // Convert SOL to lamports
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      // Check if user has enough balance
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      if (balance < lamports) {
        throw new Error(`Insufficient balance. You have ${balance / LAMPORTS_PER_SOL} SOL but trying to donate ${amount} SOL`);
      }

      // Create donation instruction
      const instruction = await program.methods
        .donate(new BN(lamports))
        .accounts({
          campaign: campaignPubkey,
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const transaction = new Transaction().add(instruction);
      const latestBlockhash = await provider.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = provider.wallet.publicKey;

      // Send and confirm transaction
      const signature = await provider.sendAndConfirm(transaction, [], {
        commitment: 'confirmed',
      });

      console.log('Donation successful, signature:', signature);
      setWalletStatus(`Successfully donated ${amount} SOL to campaign!`);
      
      // Refresh campaigns to show updated donation amount
      await getCampaigns();
      
    } catch (error) {
      console.error('Error donating to campaign:', error);
      const anyErr = error as any;
      if ((anyErr?.message || '').includes('User rejected') || (anyErr?.message || '').includes('User rejected the request')) {
        setWalletStatus('Donation cancelled by user.');
      } else {
        setWalletStatus('Error donating to campaign: ' + (error as Error).message);
      }
    } finally {
      setDonatingCampaign(null);
      setDonationAmount('0.1');
    }
  };

  // Format lamports to SOL
  const formatSol = (lamports: BN): string => {
    return (lamports.toNumber() / LAMPORTS_PER_SOL).toFixed(4);
  };

  // Truncate public key for display
  const truncatePublicKey = (publicKey: string): string => {
    return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
  };

  // Enhanced UI components with Tailwind CSS
  const renderConnectedContainer = () => {
    return (
      <div className="mt-5">
        {/* Campaign Creation Form */}
        <div className="bg-gray-800 rounded-xl p-6 mb-6 border border-gray-700 shadow-lg">
          <h3 className="text-white text-xl font-bold mb-4">Create New Campaign</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 mb-2 font-semibold">
                Campaign Name *
              </label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Enter unique campaign name"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-gray-300 mb-2 font-semibold">
                Description
              </label>
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

        {/* Action Buttons */}
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

        {/* Campaigns Display */}
        <div className="mt-8">
          <h2 className="text-2xl font-bold text-white mb-6 pb-4 border-b border-gray-700">
            Campaigns ({campaigns.length})
          </h2>
          
          {loading ? (
            <div className="text-center py-12 text-gray-400">
              <p>Loading campaigns...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12 bg-gray-800 rounded-xl border-2 border-dashed border-gray-600">
              <p className="text-gray-400 text-lg">No campaigns found. Create your first campaign!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {campaigns.map((campaign, index) => (
                <div
                  key={campaign.publicKey.toString()}
                  className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg hover:shadow-2xl transition-all duration-300 hover:border-blue-500 hover:transform hover:-translate-y-2"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-white text-lg font-bold flex-1 mr-2">
                      {campaign.account.name}
                    </h3>
                    <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-bold shadow-lg">
                      #{index + 1}
                    </span>
                  </div>
                  
                  <p className="text-gray-300 mb-4 leading-relaxed">
                    {campaign.account.description}
                  </p>
                  
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Amount Donated</div>
                      <div className="text-lg font-bold text-green-400">
                        {formatSol(campaign.account.amountDonated)} SOL
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-xs text-gray-400 mb-1">Admin</div>
                      <div className="text-sm text-gray-300 font-mono">
                        {truncatePublicKey(campaign.account.admin.toString())}
                      </div>
                    </div>
                  </div>

                  {/* Donation Section */}
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
                      <span className="px-3 py-2 bg-gray-700 text-gray-300 rounded text-sm font-semibold">
                        SOL
                      </span>
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
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderNotConnectedContainer = () => {
    return (
      <div className="text-center py-12 px-4">
        <div className="bg-gray-800 rounded-2xl p-8 md:p-12 border-2 border-dashed border-gray-600 shadow-2xl max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Connect Your Wallet to Get Started
          </h2>
          <p className="text-gray-400 mb-8 text-lg">
            Connect your Phantom wallet to create campaigns and support creators on Solana
          </p>
          <button
            onClick={connectWallet}
            className="px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-2xl text-lg"
          >
            Connect to Phantom Wallet
          </button>
        </div>
      </div>
    );
  };

  useEffect(() => {
    console.log('useEffect running');

    const checkIfWalletIsConnected = async () => {
      console.log('Checking wallet connection');
      try {
        if (typeof window !== 'undefined') {
          const { solana } = window as SolanaWindow;
          if (solana && solana.isPhantom) {
            console.log('Phantom wallet found!');
            if (solana.isConnected && solana.publicKey) {
              const pubKey = solana.publicKey.toString();
              setWalletStatus('Phantom wallet found and connected!');
              setIsWalletConnected(true);
              setPublicKey(pubKey);
              console.log('Wallet already connected, public key:', pubKey);
              await getCampaigns();
            } else {
              setWalletStatus('Phantom wallet found but not connected.');
              setIsWalletConnected(false);
            }
          } else {
            console.log('Phantom wallet not found');
            setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻');
            setIsWalletConnected(false);
          }
        } else {
          console.log('Window undefined');
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error);
        setWalletStatus('Error checking wallet connection. Please try again.');
        setIsWalletConnected(false);
      }
    };

    checkIfWalletIsConnected();

    const onLoad = () => {
      console.log('Window load event fired');
      checkIfWalletIsConnected();
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-3xl p-6 md:p-8 shadow-2xl border border-gray-700/50">
            {/* Header */}
            <header className="text-center mb-8 pb-8 border-b border-gray-700/50">
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-green-400 bg-clip-text text-transparent mb-4">
                Solana Campaign Platform
              </h1>
              <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto">
                Create and support amazing projects on the Solana blockchain
              </p>
            </header>

            {/* Status Display */}
            {walletStatus && (
              <div className={`p-4 mb-6 rounded-xl text-center font-semibold shadow-lg ${
                walletStatus.includes('Error') 
                  ? 'bg-red-900/30 border border-red-500/50 text-red-300' 
                  : walletStatus.includes('success') 
                  ? 'bg-green-900/30 border border-green-500/50 text-green-300'
                  : 'bg-blue-900/30 border border-blue-500/50 text-blue-300'
              }`}>
                {walletStatus}
              </div>
            )}

            {/* Wallet Info */}
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

            {/* Main Content */}
            {isWalletConnected ? renderConnectedContainer() : renderNotConnectedContainer()}

            {/* Footer */}
            <footer className="mt-12 pt-8 border-t border-gray-700/50 text-center text-gray-500 text-sm">
              <p>Check the browser console for debug logs. Built with Next.js, Solana, and Anchor.</p>
            </footer>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}