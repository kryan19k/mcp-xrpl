import { server } from '@passwordless-id/webauthn';
import { getChallenge } from './challenge.post';
import { users, type User } from './users.js';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { username, authentication } = body;

    if (!username || !authentication) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Incomplete authentication data',
      });
    }

    // Check if user exists
    const user = users.find((u: User) => u.username === username);
    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User not found',
      });
    }

    // Get the challenge for this user
    const challenge = getChallenge(username, 'authentication');
    if (!challenge) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid or expired challenge, please try again',
      });
    }

    // Verify WebAuthn authentication
    try {
      const expected = {
        challenge,
        origin: 'http://localhost:3000', // Fixed value for development
        userVerified: true,
      };

      const credential = user.credentials.find((cred: {id: string}) => cred.id === authentication.credentialId);
      if (!credential) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Credential not found for this user',
        });
      }

      const authenticationParsed = await server.verifyAuthentication(
        authentication,
        {
          ...credential,
          // Required by the library but not in the type
          userId: username,
          counter: 0,
        } as any,
        expected
      );

      // Authentication successful, return user data
      return {
        success: true,
        message: 'Authentication successful',
        user: {
          username: user.username,
          credentials: user.credentials,
          xrplAddress: user.xrplAddress,
          registeredAt: user.registeredAt,
          initialBalance: user.initialBalance
        }
      };
    } catch (error: any) {
      console.error('Error during WebAuthn authentication:', error);
      throw createError({
        statusCode: 400,
        statusMessage: 'WebAuthn authentication failed',
      });
    }
  } catch (error: any) {
    console.error('Error during authentication:', error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Authentication error',
    });
  }
}); 