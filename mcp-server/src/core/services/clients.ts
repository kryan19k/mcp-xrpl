import { Client } from "xrpl";
import { MAINNET_URL, TESTNET_URL } from "../constants.js";

// Helper function for XRPL client connection
export async function getXrplClient(useTestnet = false): Promise<Client> {
    const serverUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    const client = new Client(serverUrl, {
        connectionTimeout: 20000, // 20 seconds timeout
    });

    try {
        await client.connect();
        return client;
    } catch (error) {
        console.error(
            `Failed to connect to XRPL server at ${serverUrl}:`,
            error
        );
        throw error;
    }
}
