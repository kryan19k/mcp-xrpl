// Simulated database for users
// Note: In production, use a real database
export interface User {
  username: string;
  credentials: Array<{
    id: string;
    publicKey: string;
    algorithm: string;
    transports?: string[];
  }>;
  xrplAddress: string;
  registeredAt: number;
  initialBalance?: string; // Initial balance obtained from faucet
  loginMethod?: string; // Method used for login: 'webauthn', 'seed_import'
}

export const users: User[] = []; 

// Helper function to get a user by username
export function getUserByUsername(username: string): User | undefined {
  return users.find(user => user.username === username);
}

// Helper function to save a user
export function saveUser(user: User): void {
  users.push(user);
} 