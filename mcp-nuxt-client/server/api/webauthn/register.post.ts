import { server } from '@passwordless-id/webauthn';
import { getChallenge } from './challenge.post';
import { Wallet, Client, dropsToXrp } from 'xrpl';
import { users, type User, getUserByUsername, saveUser } from './users';
import * as xrpl from 'xrpl';

// Function to create and fund a wallet via TestNet faucet
async function fundWallet(): Promise<{success: boolean, wallet?: Wallet, balance?: string, error?: string}> {
  const client = new Client('wss://s.altnet.rippletest.net:51233');
  
  try {
    console.log('Connecting to XRPL TestNet...');
    await client.connect();

    // Create and fund a new wallet automatically
    console.log('Creating and funding wallet...');
    const fundResult = await client.fundWallet();
    const newWallet = fundResult.wallet;
    
    console.log('Wallet created successfully:', { address: newWallet.address });
    await client.disconnect();

    return {
      success: true,
      wallet: newWallet
    };
  } catch (error) {
    console.error('Error creating and funding wallet:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export default defineEventHandler(async (event) => {
  try {
    // Get request data
    const body = await readBody(event);
    console.log('Received registration request:', { ...body, registration: '(omitted for brevity)' });
    const { username, registration, challenge } = body;

    // Validate request data
    if (!username || !registration || !challenge) {
      console.log('Missing required fields in registration request');
      return createError({
        statusCode: 400,
        statusMessage: 'Incomplete registration data'
      });
    }

    // Check if user exists
    const existingUser = getUserByUsername(username);
    if (existingUser) {
      console.log('Username already exists:', username);
      return createError({
        statusCode: 409,
        statusMessage: 'Username already exists'
      });
    }

    // Verify registration with correct parameters format
    console.log('Verifying registration challenge...');
    const verification = await server.verifyRegistration(
      registration, 
      {
        challenge: challenge,
        origin: "http://localhost:3000"
      }
    );
    console.log('Registration verification successful');

    // Create and fund an XRPL wallet for account abstraction
    console.log('Creating XRPL wallet...');
    const walletResult = await fundWallet();
    
    if (!walletResult.success || !walletResult.wallet) {
      console.error('Failed to create wallet:', walletResult.error);
      throw new Error(walletResult.error || 'Failed to create wallet');
    }
    
    const xrplAddress = walletResult.wallet.address;
    const xrplSeed = walletResult.wallet.seed;
    console.log('Wallet created with address:', xrplAddress);

    // Create new user
    const newUser: User = {
      username,
      credentials: [{
        id: verification.credential.id,
        publicKey: verification.credential.publicKey,
        algorithm: verification.credential.algorithm,
        transports: verification.credential.transports
      }],
      xrplAddress,
      registeredAt: Date.now(),
      initialBalance: '10.0' // Default initial balance when funding with the TestNet faucet
    };

    // Save user
    console.log('Saving user to database:', { ...newUser, credentials: '(omitted for brevity)' });
    saveUser(newUser);

    // Create response object explicitly
    const responseData = {
      user: newUser,
      xrplSeed: xrplSeed  // Include the seed in the response
    };
    
    console.log('Sending registration response:', { 
      ...responseData, 
      user: { ...responseData.user, credentials: '(omitted for brevity)' },
      xrplSeed: '(omitted for security)'
    });

    // Return success with user data
    return responseData;
  } catch (error: any) {
    console.error('Registration error:', error);
    
    // Return error with detailed message
    return {
      statusCode: 500,
      statusMessage: error.message || 'Registration error',
      error: true
    };
  }
}); 