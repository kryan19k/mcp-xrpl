import { Client, Wallet } from "xrpl";
import { DID_PREFIX } from "./constants.js";

// Helper function to create DID document for an account
export function createDIDDocument(
    address: string,
    publicKey: string,
    network: string
) {
    const did = `${DID_PREFIX}${network}:${address}`;

    return {
        "@context": "https://www.w3.org/ns/did/v1",
        id: did,
        controller: did,
        verificationMethod: [
            {
                id: `${did}#keys-1`,
                type: "Ed25519VerificationKey2018",
                controller: did,
                publicKeyHex: publicKey,
            },
        ],
        authentication: [`${did}#keys-1`],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
    };
}

// Helper function to store DID document in account's memos
export async function storeDIDDocument(
    client: Client,
    wallet: Wallet,
    didDocument: any
) {
    // Convert DID document to stringified JSON
    const didDocumentStr = JSON.stringify(didDocument);

    // Create a self-transaction to store the DID document in account memos
    const tx: any = {
        TransactionType: "AccountSet",
        Account: wallet.address,
        Memos: [
            {
                Memo: {
                    MemoType: Buffer.from("did:document")
                        .toString("hex")
                        .toUpperCase(),
                    MemoData: Buffer.from(didDocumentStr)
                        .toString("hex")
                        .toUpperCase(),
                },
            },
        ],
    };

    const prepared = await client.autofill(tx);
    const signed = wallet.sign(prepared);
    return await client.submitAndWait(signed.tx_blob);
}

// Helper function to retrieve DID document from account transactions
export async function retrieveDIDDocument(client: Client, address: string) {
    // Get account transactions
    const transactions = await client.request({
        command: "account_tx",
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        binary: false,
        limit: 100,
        forward: false,
    });

    // Look for the most recent transaction with a DID document memo
    for (const tx of transactions.result.transactions) {
        // Use a more specific type for the transaction object
        const transaction = tx.tx as unknown as {
            Memos?: Array<{
                Memo: {
                    MemoType: string;
                    MemoData: string;
                };
            }>;
        };

        if (transaction && transaction.Memos) {
            for (const memo of transaction.Memos) {
                const memoType = memo.Memo.MemoType;
                const memoData = memo.Memo.MemoData;

                if (
                    Buffer.from(memoType, "hex").toString() === "did:document"
                ) {
                    try {
                        const didDocument = JSON.parse(
                            Buffer.from(memoData, "hex").toString()
                        );
                        return didDocument;
                    } catch (e) {
                        // If parsing fails, continue to the next memo
                        continue;
                    }
                }
            }
        }
    }

    return null;
}
