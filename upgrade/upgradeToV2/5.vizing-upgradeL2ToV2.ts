/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if */
/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved */
import {expect} from "chai";
import path = require("path");
import fs = require("fs");

import * as dotenv from "dotenv";
dotenv.config({path: path.resolve(__dirname, "../../.env")});
import hre, {ethers, upgrades} from "hardhat";
import {PolygonZkEVMTimelock} from "../../typechain-types";

const pathOutputJson = path.join(__dirname, "./upgrade_outputL2.json");
const deployParameters = require("./deploy_parameters.json");
const deployOutputParameters = require("./deploy_output.json");
const upgradeParameters = require("./upgrade_parameters.json");
const resetFork = async (block: number = parseInt(process.env.HARDHAT_FORK_NUMBER!)) => {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: process.env.HARDHAT_FORK_URL || "",
                    blockNumber: block,
                },
            },
        ],
    });
};
async function main() {
    upgrades.silenceWarnings();

    if (hre.network.name === "localhost") {
        console.log(`reset hardhat network: ${hre.network.name}`);
        await resetFork();
    }

    const salt = upgradeParameters.timelockSalt || ethers.ZeroHash;
    const currentBridgeAddress = "0x501CE1015Db54e8dF94Ee2DbB509cfb8C2ce0Eb4"; //deployOutputParameters.polygonZkEVMBridgeAddress;

    // Load provider
    let currentProvider = ethers.provider;

    // Load deployer
    let deployer;
    if (deployParameters.deployerPvtKey) {
        deployer = new ethers.Wallet(deployParameters.deployerPvtKey, currentProvider);
    } else if (process.env.DEPLOYER_PRIVATE_KEY) {
        deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, currentProvider);
    } else if (process.env.MNEMONIC) {
        deployer = ethers.HDNodeWallet.fromMnemonic(
            ethers.Mnemonic.fromPhrase(process.env.MNEMONIC),
            "m/44'/60'/0'/0/0"
        ).connect(currentProvider);
    } else {
        [deployer] = await ethers.getSigners();
    }

    console.log("deploying with: ", deployer.address);

    // Prepare Upgrade PolygonZkEVMBridge
    const PreviousBridgeFactory = (await ethers.getContractFactory("PolygonZkEVMBridge")) as any;

    // Import OZ upgrades
    await upgrades.forceImport(currentBridgeAddress as string, PreviousBridgeFactory, "transparent" as any);
    console.log("bridge: ", currentBridgeAddress);
    const proxyAdmin = await upgrades.admin.getInstance();

    // Assert correct admin
    expect(await upgrades.erc1967.getAdminAddress(currentBridgeAddress as string)).to.be.equal(proxyAdmin.target);

    // Check current timelock address and delay
    const timelockContractAddress = await proxyAdmin.owner();

    // load timelock
    const timelockContractFactory = await ethers.getContractFactory("PolygonZkEVMTimelock");
    const timelockContract = (await timelockContractFactory.attach(timelockContractAddress)) as PolygonZkEVMTimelock;
    const timelockDelay = await timelockContract.getMinDelay();

    console.log("timelockAddress: ", timelockContract.target, {timelockDelay});

    // prapare upgrades
    const polygonZkEVMBridgeFactory = await ethers.getContractFactory("PolygonZkEVMBridgeV2", deployer);

    const newBridgeImpl = await upgrades.prepareUpgrade(currentBridgeAddress, polygonZkEVMBridgeFactory, {
        unsafeAllow: ["constructor"],
    });

    console.log("#######################\n");
    console.log(`PolygonZkEVMBridge impl: ${newBridgeImpl}`);

    console.log("you can verify the new impl address with:");
    console.log(`npx hardhat verify ${newBridgeImpl} --network ${process.env.HARDHAT_NETWORK}`);

    const operationBridge = genOperation(
        proxyAdmin.target,
        0, // value
        proxyAdmin.interface.encodeFunctionData("upgrade", [currentBridgeAddress, newBridgeImpl]),
        ethers.ZeroHash, // predecesoor
        salt // salt
    );

    // Schedule operation
    const scheduleData = timelockContractFactory.interface.encodeFunctionData("schedule", [
        operationBridge.target,
        operationBridge.value,
        operationBridge.data,
        ethers.ZeroHash, // predecesoor
        salt, // salt
        timelockDelay,
    ]);

    // Execute operation
    const executeData = timelockContractFactory.interface.encodeFunctionData("execute", [
        operationBridge.target,
        operationBridge.value,
        operationBridge.data,
        ethers.ZeroHash, // predecesoor
        salt, // salt
    ]);

    console.log({scheduleData});
    console.log({executeData});

    const outputJson = {
        scheduleData,
        executeData,
        timelockContractAddress,
    };
    fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

// OZ test functions
function genOperation(target: any, value: any, data: any, predecessor: any, salt: any) {
    const abiEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes", "uint256", "bytes32"],
        [target, value, data, predecessor, salt]
    );
    const id = ethers.keccak256(abiEncoded);
    return {
        id,
        target,
        value,
        data,
        predecessor,
        salt,
    };
}
