async function main() {
    const KycContract = await ethers.getContractFactory("Kyc");
    const kyc = await KycContract.deploy();
    console.log("Contract Address ", kyc.address);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.log(e);
        process.exit(1);
    });