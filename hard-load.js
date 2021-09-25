const path = require('path');
const { Blockchain } = require('./dist/index');

const resolveDbName = (name) => path.join(__dirname, 'db', name);

(async () => {
    const blockchain = new Blockchain(resolveDbName('hard-load'));

    await blockchain.createGenesisBlock();

    // add 700000 blocks
    for (let i = 0; i < 700000; i+=100) {
        const promises = [];
        for (let j = 0; j < 10000; j++) {
            promises.push(blockchain.addBlock(`block ${i}-${j}`));
        }

        await Promise.all(promises);

        // print progress percent
        const percent = ((i / 700000) * 100).toFixed(2);
        process.stdout.write(`\r${percent}% ${i}/${700000}`);
    }

    const lastBlock = await blockchain.getLastBlock();
    console.info(lastBlock);
})();
