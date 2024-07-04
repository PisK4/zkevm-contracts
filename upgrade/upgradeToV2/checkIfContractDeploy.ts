import {ethers} from "hardhat";
import fs from "fs";
import path from "path";
import {Signer, Wallet} from "ethers";
import {PolygonZkEVMTimelock} from "../../typechain-types";
async function main() {
    let upgradeSigner: Signer;
    let currentProvider = ethers.provider;

    if (process.env.DEPLOYER_PRIVATE_KEY) {
        upgradeSigner = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, currentProvider);
    } else if (process.env.MNEMONIC) {
        upgradeSigner = ethers.HDNodeWallet.fromMnemonic(
            ethers.Mnemonic.fromPhrase(process.env.MNEMONIC),
            "m/44'/60'/0'/0/0"
        ).connect(currentProvider);
    } else {
        [upgradeSigner] = await ethers.getSigners();
    }
    console.log(`current block: ${await currentProvider.getBlockNumber()}`);

    const testAddress = "0x501CE1015Db54e8dF94Ee2DbB509cfb8C2ce0Eb4";

    const contractCode = await currentProvider.getCode(testAddress);
    if (contractCode === "0x") {
        throw new Error("contract not deployed");
    } else {
        console.log(`contract is deployed: ${contractCode}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
