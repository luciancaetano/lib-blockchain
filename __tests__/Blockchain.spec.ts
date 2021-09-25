import crypto from 'crypto';
import path from 'path';
import rimraf from 'rimraf';
import { Block, Blockchain } from '../src';

jest.setTimeout(10000);

jest.mock('../src/Mutex/LockMutex', () => ({
    LockMutex: class LockMutex {
        public acquire() {
            return new Promise<void>((resolve) => {
                setTimeout(resolve, 10);
            });
        }

        public release() {
            //
        }
    },
}));

const resolveDbName = (name: string) => path.join(__dirname, '..', 'db', name);

interface BlockType extends Block {
    data: string;
}

describe('Blockchain', () => {
    let blockchain!: Blockchain<BlockType>;
    let dbPath: string;

    beforeEach(async () => {
        const dbName = crypto.randomBytes(16).toString('hex');
        dbPath = resolveDbName(dbName);

        blockchain = new Blockchain<BlockType>(dbPath);
        await blockchain.createGenesisBlock();
    });

    afterEach(async () => {
        await blockchain.close();
        await new Promise<void>((resolve) => {
            rimraf(dbPath, (err) => {
                resolve();
                if (err) {
                    throw err;
                }
            });
        });
    });

    it('Blockchain must be defined', () => {
        expect(blockchain).toBeDefined();
    });

    it('create genesis block', async () => {
        const lastBlock = await blockchain.getLastBlock();
        const count = await blockchain.length();

        expect(count).toBe(1);
        expect(lastBlock?.index).toBe(0);
        expect(lastBlock?.data).toMatchObject({ genesis: true });
    });

    it('length', async () => {
        const count = Math.floor(Math.random() * (100 - 10 + 1)) + 10;

        for (let i = 0; i < count; i++) {
            await blockchain.addBlock({ data: `Block ${i}` });
        }

        const length = await blockchain.length();

        const b = await blockchain.getBlockchain();

        expect(length).toBe(b.length);
    });

    it('getLastBlock', async () => {
        await blockchain.addBlock({ data: 'Block 1' });
        await blockchain.addBlock({ data: 'Block 2' });
        await blockchain.addBlock({ data: 'Block 3' });

        const lastBlock = await blockchain.getLastBlock();

        expect(lastBlock?.data).toBe('Block 3');
    });

    it('findBlock', async () => {
        await blockchain.addBlock({ data: 'Block 1' });
        await blockchain.addBlock({ data: 'Block 2' });
        await blockchain.addBlock({ data: 'Block 3' });

        const foundBlock = await blockchain.findBlock((b) => b.data === 'Block 2');

        expect(foundBlock?.data).toBe('Block 2');
    });

    it('replaceBlockchain', async () => {
        blockchain.addBlock({ data: 'Block 1' });
        blockchain.addBlock({ data: 'Block 2' });
        blockchain.addBlock({ data: 'Block 3' });

        const newBlocks: BlockType[] = [];

        const dbName = crypto.randomBytes(16).toString('hex');
        const p = resolveDbName(dbName);

        const othjerChain = new Blockchain<BlockType>(p);
        await othjerChain.awaitForDatabaseConnection();

        await othjerChain.createGenesisBlock();
        await othjerChain.addBlock({ data: 'Block -1' });
        await othjerChain.addBlock({ data: 'Block -2' });
        await othjerChain.addBlock({ data: 'Block 3' });

        (await othjerChain.getBlockchain()).forEach((b) => {
            newBlocks.push(b);
        });

        await othjerChain.close();

        await new Promise<void>((resolve) => {
            rimraf(p, (err) => {
                resolve();
                if (err) {
                    throw err;
                }
            });
        });

        const currentBlocks = await blockchain.getBlockchain();

        await blockchain.replaceBlockchain(newBlocks);

        const newCurrentBlocks = await blockchain.getBlockchain();

        expect(newCurrentBlocks).toEqual(newBlocks);
        expect(newCurrentBlocks).not.toEqual(currentBlocks);
    });

    it('getBlockByIndex', async () => {
        await blockchain.addBlock({ data: 'Block 1' });
        await blockchain.addBlock({ data: 'Block 2' });
        await blockchain.addBlock({ data: 'Block 3' });

        const block = await blockchain.getBlockByIndex(2);

        expect(block?.data).toBe('Block 2');
    });

    it('getBlockchain', async () => {
        await blockchain.addBlock({ data: 'Block 1' });
        await blockchain.addBlock({ data: 'Block 2' });
        await blockchain.addBlock({ data: 'Block 3' });
        const blocks = await blockchain.getBlockchain();

        expect(blocks.length).toBe(4);
    });

    it('validate', async () => {
        await blockchain.addBlock({ data: 'Block 1' });
        await blockchain.addBlock({ data: 'Block 2' });
        await blockchain.addBlock({ data: 'Block 3' });

        const isValid = await blockchain.validate();

        expect(isValid).toBe(true);
    });

    it('eachBlock', async () => {
        await blockchain.addBlock({ data: 'Block 1' });
        await blockchain.addBlock({ data: 'Block 2' });
        await blockchain.addBlock({ data: 'Block 3' });

        const callbacks = jest.fn();

        await blockchain.forEach(callbacks);

        expect(callbacks).toHaveBeenCalledTimes(4);
    });
});
