import {ethers} from "hardhat";
import fs from "fs";
import path from "path";
import {Signer, Wallet} from "ethers";
import {PolygonZkEVMTimelock} from "../../typechain-types";

const CANCELLER_ROLE = "0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783";
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const EXECUTOR_ROLE = "0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63";
const PROPOSER_ROLE = "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1";
const TIMELOCK_ADMIN_ROLE = "0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5";

async function main() {
    let upgradeSigner: Signer;
    let currentProvider = ethers.provider;

    const upgradeParams = fetchTimeLockUpgradeParams();
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
    console.log("TimeLock contract address:", upgradeParams.timelockContractAddress);
    console.log("scheduleData:", upgradeParams.scheduleData);
    console.log("executeData:", upgradeParams.executeData);

    const CDKValidiumTimelockFactory = await ethers.getContractFactory("PolygonZkEVMTimelock", upgradeSigner);
    const CDKValidiumTimelock = CDKValidiumTimelockFactory.attach(
        upgradeParams.timelockContractAddress
    ) as PolygonZkEVMTimelock;
    if ((await currentProvider.getCode(await CDKValidiumTimelock.getAddress())) === "0x") {
        throw new Error("CDKValidiumTimelockFactory contract is not deployed");
    }
    if ((await CDKValidiumTimelock.hasRole(PROPOSER_ROLE, await upgradeSigner.getAddress())) === false) {
        throw new Error("Only proposer can propose");
    }
    console.log("check if upgrade is already scheduled...");
    const tx = await upgradeSigner.sendTransaction({
        to: upgradeParams.timelockContractAddress,
        data: upgradeParams.scheduleData,
        value: upgradeParams.value,
    });
    const recipt = await tx.wait();
    console.log(`waiting for tx to be mined... ${tx.hash}`);
    // const log = recipt!.logs.find((log) => log.address === upgradeParams.timelockContractAddress);
    // const id = log!.topics[1];
    // console.log(`Scheduled upgrade with id ${id.toString()}, done proposing!`);
    // console.log(`you can execute upgrade with id bellow at ${await CDKValidiumTimelock.getTimestamp(id)}`);
}

export function fetchTimeLockUpgradeParams() {
    let pathUpgradeParams = path.join(__dirname, "./upgrade_output.json");
    if (process.env.UPGRADE_L2 !== undefined) {
        pathUpgradeParams = path.join(__dirname, "./upgrade_outputL2.json");
    }
    return JSON.parse(fs.readFileSync(pathUpgradeParams, "utf-8"));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
