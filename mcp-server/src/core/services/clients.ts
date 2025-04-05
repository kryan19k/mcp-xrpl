import { Client } from "xrpl";
import { MAINNET_URL, TESTNET_URL } from "../constants";

// Helper function for XRPL client connection
export async function getXrplClient(useTestnet = false): Promise<Client> {
    const serverUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    const client = new Client(serverUrl);
    await client.connect();
    return client;
}
