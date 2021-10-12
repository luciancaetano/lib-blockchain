import crypto from 'crypto';
import path from 'path';
import rimraf from 'rimraf';
import { Blockchain, Block } from '../src';

jest.setTimeout(10000);

const resolveDbName = (name: string) => path.join(__dirname, '..', 'db', name);

describe('Blockchain', () => {
    let blockchain!: Blockchain;
    let dbPath: string;

    beforeEach(async () => {
        const dbName = crypto.randomBytes(16).toString('hex');
        dbPath = resolveDbName(dbName);

        blockchain = new Blockchain(dbPath);
        await blockchain.genesis();
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
        expect(lastBlock?.data).toBeTruthy();
    });

    it('length', async () => {
        const count = Math.floor(Math.random() * (100 - 10 + 1)) + 10;

        for (let i = 0; i < count; i++) {
            await blockchain.push({ data: Buffer.from(`Block ${i}`, 'utf-8') });
        }

        const length = await blockchain.length();

        const b = await blockchain.toArray();

        expect(length).toBe(b.length);
    });

    it('getLastBlock', async () => {
        await blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });

        const lastBlock = await blockchain.getLastBlock();

        expect(lastBlock?.data.toString('utf-8')).toBe('Block 3');
    });

    it('findBlock', async () => {
        await blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });

        const foundBlock = await blockchain.find((b) => b.data.toString('utf-8') === 'Block 2');

        expect(foundBlock?.data.toString('utf-8')).toBe('Block 2');
    });

    it('replaceBlockchain', async () => {
        blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });

        const newBlocks: Block[] = [];

        const dbName = crypto.randomBytes(16).toString('hex');
        const p = resolveDbName(dbName);

        const othjerChain = new Blockchain(p);
        await othjerChain.waitDbOpen();

        await othjerChain.genesis();
        await othjerChain.push({ data: Buffer.from('Block -1', 'utf-8') });
        await othjerChain.push({ data: Buffer.from('Block -2', 'utf-8') });
        await othjerChain.push({ data: Buffer.from('Block 3', 'utf-8') });

        (await othjerChain.toArray()).forEach((b) => {
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

        const currentBlocks = await blockchain.toArray();

        await blockchain.replace(newBlocks);

        const newCurrentBlocks = await blockchain.toArray();

        expect(newCurrentBlocks).toEqual(newBlocks);
        expect(newCurrentBlocks).not.toEqual(currentBlocks);
    });

    it('getBlockByIndex', async () => {
        await blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });

        const block = await blockchain.at(2);

        expect(block?.data.toString('utf-8')).toBe('Block 2');
    });

    it('toArray', async () => {
        await blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });
        const blocks = await blockchain.toArray();

        expect(blocks.length).toBe(4);
    });

    it('validate', async () => {
        await blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });

        const isValid = await blockchain.validate();

        expect(isValid).toBe(true);
    });

    it('eachBlock', async () => {
        await blockchain.push({ data: Buffer.from('Block 1', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 2', 'utf-8') });
        await blockchain.push({ data: Buffer.from('Block 3', 'utf-8') });

        const callbacks = jest.fn();

        await blockchain.forEach(callbacks);

        expect(callbacks).toHaveBeenCalledTimes(4);
    });
});
