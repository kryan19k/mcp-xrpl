import { server } from '@passwordless-id/webauthn';

// Temporarily store generated challenges
const challenges = new Map<string, { challenge: string, timestamp: number, type: 'registration' | 'authentication' }>();

// Challenge validity duration (5 minutes)
const CHALLENGE_TIMEOUT = 5 * 60 * 1000;

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { username, type = 'registration' } = body;

    if (!username) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Username is required',
      });
    }

    // Generate a random challenge
    const challenge = server.randomChallenge();
    
    // Store the challenge with a timestamp and type
    challenges.set(username, {
      challenge,
      timestamp: Date.now(),
      type
    });

    // Clean up expired challenges
    cleanupExpiredChallenges();

    return { challenge };
  } catch (error) {
    console.error('Error generating challenge:', error);
    throw createError({
      statusCode: 500,
      statusMessage: 'Error generating challenge',
    });
  }
});

// Function to clean up expired challenges
function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [username, data] of challenges.entries()) {
    if (now - data.timestamp > CHALLENGE_TIMEOUT) {
      challenges.delete(username);
    }
  }
}

// Function to retrieve a challenge (used by registration and authentication APIs)
export function getChallenge(username: string, type?: 'registration' | 'authentication'): string | null {
  const data = challenges.get(username);
  
  if (!data) {
    return null;
  }
  
  // Check if the challenge hasn't expired
  if (Date.now() - data.timestamp > CHALLENGE_TIMEOUT) {
    challenges.delete(username);
    return null;
  }
  
  // If a type is specified, check that the challenge is of the right type
  if (type && data.type !== type) {
    return null;
  }
  
  return data.challenge;
} 