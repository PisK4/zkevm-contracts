import {ethers} from "hardhat";
import fs from "fs";
import path from "path";
import {Signer, Wallet} from "ethers";

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
    console.log("chainId:", (await currentProvider.getNetwork()).chainId);
    console.log("upgradeSigner address:", (await upgradeSigner.getAddress()).toString());

    // send 1 wei to random address
    for (let i = 0; i < 10; i++) {
        const tx = await upgradeSigner.sendTransaction({
            to: ethers.Wallet.createRandom().address,
            value: 1,
        });
        console.log("tx hash: ", tx.hash);
        await tx.wait();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
