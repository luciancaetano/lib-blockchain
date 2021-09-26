const path = require('path');
const { Blockchain } = require('./dist/index');

const resolveDbName = (name) => path.join(__dirname, 'db', name);

(async () => {
    const blockchain = new Blockchain(resolveDbName('hard-load'));

    await blockchain.createGenesisBlock();

    // add 1000 blocks
    for (let i = 0; i < 1000; i += 100) {
        const promises = [];
        for (let j = 0; j < 100; j++) {
            promises.push(blockchain.addBlock({ data: `block ${i}-${j}` }));
        }

        await Promise.all(promises);

        // print progress percent
        const percent = ((i / 1000) * 100).toFixed(2);
        process.stdout.write(`\r${percent}% ${i}/${1000}`);
    }

    const lastBlock = await blockchain.getLastBlock();
    const valid = blockchain.validate();

    console.log(`\n\n${valid ? 'valid' : 'invalid'} blockchain`);

    console.info(lastBlock);
})();
