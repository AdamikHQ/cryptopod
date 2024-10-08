import {
  secp256k1PrivateKeyToJwk,
  SigningAlg,
} from "@narval-xyz/armory-sdk/signature";
import type { SIGNER, Signer } from ".";

import {
  AccountEntity,
  Action,
  AuthClient,
  EntityStoreClient,
  Hex,
  Permission,
  VaultClient,
  buildSignerEip191,
  privateKeyToJwk,
  Request,
} from "@narval-xyz/armory-sdk";
import assert from "assert";
import { v4 as uuid } from "uuid";
import { privateKeyToAddress } from "viem/accounts";

const getEnv = (key: string): string => {
  const value = process.env[key];

  assert(value !== undefined, `Missing env variable ${key}`);

  return value;
};

const clientId = getEnv("ARMORY_CLIENT_ID");
const clientSecret = getEnv("ARMORY_CLIENT_SECRET");
const getPrivateKey = (key: string) => {
  return getEnv(key) as Hex;
};
const userPrivateKey = getPrivateKey("ARMORY_USER_PRIVATE_KEY");
const addr = privateKeyToAddress(userPrivateKey);
const userJwk = privateKeyToJwk(userPrivateKey, "ES256K", addr);
const accountId = `eip155:eoa:${addr}`;

const unsafeSignerPrivateKey = process.env.ARMORY_USER_PRIVATE_KEY as Hex;
const signerAddress = privateKeyToAddress(unsafeSignerPrivateKey);
const signerJwk = secp256k1PrivateKeyToJwk(
  unsafeSignerPrivateKey,
  signerAddress
); // Need to pass the address as kid since my Datastore only references the address, not the whole pubkey.

const entityStorePrivateKey = getPrivateKey("ARMORY_ENTITY_STORE_PRIVATE_KEY");
const policyStorePrivateKey = getPrivateKey("ARMORY_POLICY_STORE_PRIVATE_KEY");

export class NarvalSigner implements Signer {
  authClient: AuthClient;
  vaultClient: VaultClient;
  name: SIGNER = "narval";
  entityStoreClient: EntityStoreClient;

  constructor() {
    console.log("narval - init auth client");

    this.authClient = new AuthClient({
      host: "https://auth.armory.narval.xyz",
      clientId,
      signer: {
        jwk: userJwk,
        alg: "EIP191",
        sign: buildSignerEip191(userPrivateKey),
      },
    });

    console.log("narval - init vault client");
    this.vaultClient = new VaultClient({
      host: "https://vault.armory.narval.xyz",
      clientId,
      signer: {
        jwk: userJwk,
        alg: "EIP191",
        sign: buildSignerEip191(userPrivateKey),
      },
    });

    console.log("narval - init entity store client");
    this.entityStoreClient = new EntityStoreClient({
      clientSecret,
      host: "https://auth.armory.narval.xyz",
      clientId,
      signer: {
        jwk: userJwk,
        alg: "EIP191",
        sign: buildSignerEip191(userPrivateKey),
      },
    });
  }

  async createWallet(userId: string): Promise<string> {
    return "narval"; // TODO: create a Narval user per cryptopod user registered, and limit their access to their own wallets?
  }

  async createAccount(
    _1: string, // unused, all cryptopod users use the same narval user
    _2: string // unused, narval wallets provide only evm string anyway
  ): Promise<{ address: string }> {
    console.log("narval - requesting wallet create access token");
    // Request access to create wallet and account.
    const walletCreateAccessToken = await this.authClient.requestAccessToken({
      action: Action.GRANT_PERMISSION,
      resourceId: "vault",
      nonce: uuid(),
      permissions: [Permission.WALLET_CREATE],
    });
    console.log("narval - generating wallet");
    const { account } = await this.vaultClient.generateWallet({
      accessToken: walletCreateAccessToken,
    });
    const { data: entity } = await this.entityStoreClient.fetch();

    const newEntities = {
      ...entity,
      accounts: [
        ...(entity.accounts || []),
        {
          id: account.id,
          address: account.address as Hex,
          accountType: "eoa" as const,
        },
      ],
    };

    await this.entityStoreClient.signAndPush(newEntities);
    return { address: account.address };
  }

  // TODO
  async sign(transaction: string): Promise<string> {
    const request: Request = {
      resourceId: accountId,
      action: Action.SIGN_MESSAGE,
      nonce: uuid(),
      //message: transaction,
      message: "Narval Testing",
    };

    try {
      console.log("\n\n Authorization Request");
      const accessToken = await this.authClient.requestAccessToken(request);
      console.log("\n\n Authorization Response:", accessToken);

      if (accessToken) {
        console.log("\n\n🔏 Sending signing request...");

        const { signature } = await this.vaultClient.sign({
          accessToken,
          data: request,
        });

        console.log("\n\n✅ Signature:", signature);
        return signature;
      }
    } catch (error) {
      console.error(error);
      throw new Error("Narval signing error");
    }
  }

  async getSupportedAssets(): Promise<any> {
    throw new Error("Not implemented");
  }
}
