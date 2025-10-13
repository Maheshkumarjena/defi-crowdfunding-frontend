'use client'; // Marks this as a Client Component in Next.js, ensuring it runs on the client side for browser-specific APIs like window.

// Import necessary dependencies
import { useEffect, useState } from 'react'; // React hooks for state and lifecycle management
import { Connection, PublicKey } from '@solana/web3.js'; // Solana web3.js for blockchain interaction
import { Program, AnchorProvider, web3, utils, Idl, BN } from '@project-serum/anchor'; // Anchor framework for Solana program interaction
import idl from '.././idl.js'; // Import the IDL (Interface Definition Language) file for the Solana program, which defines the program's structure

// Define TypeScript interface for Solana window object to type-check Phantom wallet properties
interface SolanaWindow extends Window {
  solana?: {
    isPhantom?: boolean; // Indicates if Phantom wallet is installed
    isConnected?: boolean; // Indicates if wallet is connected
    connect?: () => Promise<{ publicKey: { toString: () => string } }>; // Connect method for wallet
    publicKey?: { toString: () => string }; // Public key of the connected wallet
  };
}

// Simple Error Boundary Component to catch and display errors in the UI
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null); // State to track errors

  if (error) {
    return <div style={{ color: 'red' }}>Error: {error}</div>; // Display error message if one exists
  }

  return <>{children}</>; // Render children if no error
}

// Validate and initialize the program ID from the IDL
const idlData: Idl = idl; // Cast imported IDL to Idl type
console.log('IDL data loaded:', JSON.stringify(idlData, null, 2)); // Debug: Log IDL content to verify structure
let programID: PublicKey | null = null; // Variable to store the program ID

try {
  // Check if IDL contains a valid address and convert it to a PublicKey
  if (idlData?.address && typeof idlData.address === 'string') {
    programID = new PublicKey(idlData.address);
    console.log('Program ID initialized:', programID.toString()); // Debug: Confirm program ID
  } else {
    console.warn('IDL address is missing or invalid'); // Warn if address is missing
  }
  // Validate that the IDL has required fields (instructions, accounts, types)
  if (!idlData.instructions || !idlData.accounts || !idlData.types) {
    throw new Error('Invalid IDL structure: Missing instructions, accounts, or types');
  }
} catch (e) {
  console.warn('Could not construct programID or validate IDL:', e); // Log any errors during validation
}

// Fallback program ID in case IDL address is invalid
const FALLBACK_PROGRAM_ID = 'GgEMjntpZKxcUxdkGkJzqkufYzdoSmezRJWHVTk3dr2h';

// Solana network configuration
const network = "https://api.devnet.solana.com"; // Use Solana devnet for testing
const opts = {
  preflightCommitment: "processed" as web3.Commitment, // Commitment level for transaction confirmation
};

const { SystemProgram } = web3; // Extract SystemProgram for creating accounts

// Main Home component
export default function Home() {
  // State variables for wallet status and connection
  const [walletStatus, setWalletStatus] = useState<string | null>(null); // Tracks wallet connection status messages
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false); // Tracks if wallet is connected
  const [publicKey, setPublicKey] = useState<string | null>(null); // Stores connected wallet's public key

  console.log('Home component rendered'); // Debug: Confirm component mounts

  // Function to create an Anchor provider for interacting with Solana
  const getProvider = () => {
    const connection = new Connection(network, opts.preflightCommitment); // Create connection to Solana devnet
    const win = window as unknown as SolanaWindow; // Cast window to SolanaWindow for type safety
    // Check if Phantom wallet is available
    if (!win.solana || !win.solana.isPhantom) {
      throw new Error('Phantom wallet not available. Please install Phantom Wallet.');
    }
    // Check if wallet is connected
    if (!win.solana.isConnected || !win.solana.publicKey) {
      throw new Error('Wallet is not connected. Please connect the wallet first.');
    }
    // Create Anchor provider with connection and wallet
    const provider = new AnchorProvider(connection, win.solana as any, {
      preflightCommitment: opts.preflightCommitment,
    });
    console.log('Provider created, wallet public key:', provider.wallet.publicKey.toString()); // Debug: Log provider details
    return provider;
  };

  // Function to ensure wallet has enough balance; requests airdrop on devnet if needed
  const ensureBalance = async (provider: AnchorProvider, minLamports: number) => {
    try {
      const conn = provider.connection; // Get connection from provider
      const pubkey = provider.wallet.publicKey; // Get wallet public key
      const balance = await conn.getBalance(pubkey); // Check current balance
      console.log('Current wallet balance (lamports):', balance); // Debug: Log balance
      if (balance < minLamports) { // If balance is below threshold
        console.log(`Balance below threshold. Requesting airdrop of ${minLamports} lamports...`);
        // Request airdrop on devnet (only works on devnet/testnet)
        const sig = await conn.requestAirdrop(pubkey, minLamports);
        // Confirm transaction with 'confirmed' commitment
        await conn.confirmTransaction(sig, 'confirmed' as web3.Commitment);
        // Wait briefly for blockhash propagation
        await new Promise((res) => setTimeout(res, 1000));
        const newBal = await conn.getBalance(pubkey); // Check new balance
        console.log('Airdrop complete. New balance (lamports):', newBal); // Debug: Log new balance
      }
    } catch (e) {
      console.warn('Airdrop/ensure balance failed:', e); // Log any errors
    }
  };

  // Function to connect to Phantom wallet
  const connectWallet = async () => {
    try {
      if (typeof window !== 'undefined') { // Ensure running in browser
        const { solana } = window as SolanaWindow; // Access Phantom wallet
        if (solana && solana.isPhantom) { // Check if Phantom is available
          const response = await solana.connect?.(); // Connect to wallet
          const pubKey = response?.publicKey.toString(); // Get public key
          setWalletStatus('Wallet connected successfully!'); // Update status
          setIsWalletConnected(true); // Mark wallet as connected
          setPublicKey(pubKey || null); // Store public key
          console.log('Wallet connected, public key:', pubKey); // Debug: Log public key
        } else {
          setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻'); // Update status if Phantom not found
          console.log('Phantom wallet not found for connection'); // Debug
        }
      }
    } catch (error) {
      console.error('Error connecting wallet:', error); // Log error
      setWalletStatus('Error connecting wallet: Please try again.'); // Update status
    }
  };

  // Function to create a campaign on the Solana blockchain
  const createCampaign = async () => {
    try {
      // Check if wallet is connected
      if (!isWalletConnected || !publicKey) {
        throw new Error('Wallet is not connected. Please connect the wallet first.');
      }
      // Validate IDL data
      if (!idlData || !idlData.instructions || !idlData.accounts || !idlData.types) {
        throw new Error('Invalid IDL data. Please check idl.js.');
      }
      const provider = getProvider(); // Get Anchor provider
      const runtimeProgramID = programID ?? new PublicKey(FALLBACK_PROGRAM_ID); // Use program ID or fallback
      if (!runtimeProgramID) {
        throw new Error('Program ID is not available. Please check idl.js.');
      }
      const program = new Program(idlData, runtimeProgramID, provider); // Initialize Anchor program

      // Debug: Log program IDs for diagnostics
      console.log('IDL declared program id:', (idlData as any).address ?? 'none');
      console.log('Using runtime program id:', runtimeProgramID.toString());
      try {
        console.log('Program.programId:', program.programId.toString());
      } catch (e) {
        // Ignore errors in logging
      }

      // Derive campaign account address using PDA (Program-Derived Address)
      const [campaign] = await PublicKey.findProgramAddress(
        [
          utils.bytes.utf8.encode("CAMPAIGN_DEMO"), // Seed for PDA
          provider.wallet.publicKey.toBuffer(), // Wallet public key as seed
        ],
        runtimeProgramID
      );

      // Ensure wallet has enough SOL (0.1 SOL) for account creation
      const thresholdLamports = Math.floor(0.1 * web3.LAMPORTS_PER_SOL);
      await ensureBalance(provider, thresholdLamports);

      // Retry loop to handle transient errors like "Blockhash not found"
      const maxAttempts = 4;
      let attempt = 0;
      let lastErr: any = null;
      // Debug: Log diagnostics before RPC call
      try {
        const declaredId = (idlData as any)?.address ?? 'none';
        const runtimeId = runtimeProgramID.toString();
        console.log('Diagnostics before RPC: IDL.address =', declaredId, ', runtimeProgramID =', runtimeId);
        try {
          console.log('Program.programId (from Program instance) =', program.programId.toString());
        } catch (e) {
          // Ignore
        }
        console.log('Types:', 'typeof IDL.address =', typeof (idlData as any)?.address, ', typeof runtimeProgramID =', typeof runtimeProgramID, ', runtimeProgramID instanceof PublicKey =', runtimeProgramID instanceof PublicKey);
        try {
          console.log('typeof program.programId =', typeof (program as any).programId, ', program.programId instanceof PublicKey =', (program as any).programId instanceof PublicKey);
        } catch (e) {
          // Ignore
        }
        // Check if program account exists on-chain
        const pInfo = await provider.connection.getAccountInfo(runtimeProgramID);
        console.log('On-chain program account info for runtimeProgramID:', pInfo ? 'exists' : 'missing/null', pInfo);
      } catch (diagErr) {
        console.warn('Program diagnostics failed:', diagErr);
      }
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          // Call the program's `create` RPC to create a campaign
          await program.rpc.create("My First Campaign", "This is my first campaign", {
            accounts: {
              campaign: campaign, // Campaign account (PDA)
              user: provider.wallet.publicKey, // Wallet public key
              systemProgram: SystemProgram.programId, // System program for account creation
              system_program: SystemProgram.programId, // Duplicate for IDL compatibility
            },
          });
          lastErr = null; // Clear error on success
          break; // Exit loop on success
        } catch (e) {
          lastErr = e; // Store last error
          const msg = (e as any)?.message || '';
          console.warn(`Attempt ${attempt} failed:`, msg); // Log attempt failure
          // Handle blockhash errors by refreshing blockhash and retrying
          if (msg.includes('Blockhash not found') || msg.includes('blockhash expired')) {
            try {
              const latest = await provider.connection.getLatestBlockhash('confirmed');
              await provider.connection.confirmTransaction({ signature: latest.lastValidBlockHeight as unknown as string, ...latest } as any);
            } catch (inner) {
              // Ignore inner errors
            }
            await new Promise((res) => setTimeout(res, 800 * attempt)); // Wait before retry
            continue;
          }
          break; // Exit loop on non-blockhash error
        }
      }
      if (lastErr) throw lastErr; // Throw last error if all attempts fail
      console.log("Campaign created with address:", campaign.toString()); // Debug: Log success
      setWalletStatus('Campaign created successfully! Address: ' + campaign.toString()); // Update UI
    } catch (error) {
      console.error('Error creating campaign:', error); // Log error
      // Handle specific Anchor error for program ID mismatch
      const anyErr = error as any;
      const isDeclaredMismatch =
        anyErr?.error?.code === 4100 ||
        (anyErr?.name === 'AnchorError' && (anyErr?.error?.name === 'DeclaredProgramIdMismatch' || (anyErr?.message || '').includes('DeclaredProgramIdMismatch')));
      if (isDeclaredMismatch) {
        console.error('DeclaredProgramIdMismatch detected. IDL-declared program id may not match the program you are calling.');
        console.log('IDL declared address:', (idlData as any)?.address ?? 'none');
        const usedRuntimeId = (programID ?? new PublicKey(FALLBACK_PROGRAM_ID)).toString();
        console.log('Runtime program id used:', usedRuntimeId);
        setWalletStatus('Error creating campaign: DeclaredProgramIdMismatch. Check `src/idl.js` address or use the correct program id.');
      } else if ((anyErr?.message || '').includes('User rejected') || (anyErr?.message || '').includes('User rejected the request')) {
        setWalletStatus('Transaction cancelled by user. Please approve the transaction in your wallet.');
      } else {
        setWalletStatus('Error creating campaign: ' + (error as Error).message); // Generic error
      }
    }
  };

  // Render UI for connected wallet
  const renderConnectedContainer = () => {
    return (
      <div>
        <button
          onClick={createCampaign} // Trigger campaign creation
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            marginTop: '10px',
          }}
        >
          Create Campaign
        </button>
      </div>
    );
  };

  // Render UI for unconnected wallet
  const renderNotConnectedContainer = () => {
    return (
      <button
        onClick={connectWallet} // Trigger wallet connection
        style={{
          padding: '10px 20px',
          backgroundColor: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
        }}
      >
        Connect to Wallet
      </button>
    );
  };

  // Effect to check wallet connection on mount
  useEffect(() => {
    console.log('useEffect running'); // Debug: Confirm effect runs

    const checkIfWalletIsConnected = async () => {
      console.log('Checking wallet connection'); // Debug: Confirm function runs
      try {
        if (typeof window !== 'undefined') { // Ensure browser environment
          const { solana } = window as SolanaWindow; // Access Phantom wallet
          if (solana && solana.isPhantom) { // Check if Phantom is installed
            console.log('Phantom wallet found!'); // Debug
            if (solana.isConnected && solana.publicKey) { // Check if connected
              const pubKey = solana.publicKey.toString();
              setWalletStatus('Phantom wallet found and connected!'); // Update status
              setIsWalletConnected(true); // Mark as connected
              setPublicKey(pubKey); // Store public key
              console.log('Wallet already connected, public key:', pubKey); // Debug
            } else {
              setWalletStatus('Phantom wallet found but not connected.'); // Update status
              setIsWalletConnected(false);
            }
          } else {
            console.log('Phantom wallet not found'); // Debug
            setWalletStatus('Phantom wallet not found. Please install Phantom Wallet 👻'); // Update status
            setIsWalletConnected(false);
          }
        } else {
          console.log('Window undefined'); // Debug: Should not happen in client component
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error); // Log error
        setWalletStatus('Error checking wallet connection. Please try again.'); // Update status
        setIsWalletConnected(false);
      }
    };

    checkIfWalletIsConnected(); // Run on component mount

    // Add event listener for window load to recheck wallet
    const onLoad = () => {
      console.log('Window load event fired'); // Debug
      checkIfWalletIsConnected();
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad); // Cleanup listener
  }, []); // Empty dependency array to run once on mount

  // Render the main UI
  return (
    <ErrorBoundary>
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Next.js Solana Campaign App</h1> {/* App title */}
        {walletStatus && <p>{walletStatus}</p>} {/* Display wallet status */}
        {isWalletConnected && publicKey && (
          <p>Connected Public Key: {publicKey}</p> // Display public key if connected
        )}
        {isWalletConnected ? renderConnectedContainer() : renderNotConnectedContainer()} {/* Conditional rendering */}
        <p>Check the browser console for debug logs.</p> {/* Prompt to check console */}
      </div>
    </ErrorBoundary>
  );
}