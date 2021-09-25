import crypto from 'crypto';
import level from 'level';
import { EventEmitter } from 'events';
import { LockMutex } from '../Mutex/LockMutex';
import { Block, GenesisBlock, OnHashFunction } from './types';

const encodeKey = (key: number) => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(key, 0);
    return buffer;
};

export class Blockchain<BlockType extends Block> {
    private db: level.LevelDB;

    private emitter = new EventEmitter();

    private lock: LockMutex;

    private isReplacing: boolean;

    /**
     * @constructor
     * @param  {string} dbPath
     */
    constructor(dbPath: string, onHash: OnHashFunction<BlockType> | null = null) {
        this.db = level(dbPath, { valueEncoding: 'json', keyEncoding: 'binary' }, (err) => {
            if (err) {
                throw err;
            } else {
                this.emitter.emit('ready');
            }
        });

        this.lock = new LockMutex();
        if (onHash) {
            this.onHash = onHash;
        }

        this.isReplacing = false;
    }

    /**
     * Calculate block hash
     *
     * @param  {BlockType} block
     */
    private onHash = async (block: BlockType) => {
        const hash = crypto.createHash('sha256');

        const target: any = {};

        Object.keys(block).forEach((key) => {
            if (key !== 'hash') {
                target[key] = (block as any)[key];
            }
        });

        hash.update(JSON.stringify(target));

        return hash.digest('hex');
    };

    /**
     * Get blocks count
     *
     * @param  {} =>newPromise<number>((resolve
     * @param  {} reject
     */
    public length = () => new Promise<number>((resolve, reject) => {
        let count = 0;

        this.db.createKeyStream({
            gte: encodeKey(0),
        })
            .on('error', reject)
            .on('data', () => count++)
            .on('close', () => resolve(count))
            .on('end', () => resolve(count));
    });

    /**
     * get Last Block
     *
     * @param  {} =>newPromise<T|null>((resolve
     * @param  {} reject
     */
    public getLastBlock = () => new Promise<BlockType | null>((resolve, reject) => {
        this.length().then((count) => {
            if (count === 0) {
                resolve(null);
            } else {
                this.db.get(encodeKey(count - 1), (err, block) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(block);
                    }
                });
            }
        });
    });

    /**
     * Creates the genesis block
     */
    public createGenesisBlock = async (): Promise<GenesisBlock | null> => {
        await this.lock.acquire();

        if (await this.getLastBlock()) {
            return null;
        }

        const genesisBlock: GenesisBlock = {
            data: { genesis: true },
            hash: '',
            index: 0,
            previousHash: null as any,
            timestamp: new Date().getTime(),
        };

        genesisBlock.hash = await this.onHash(genesisBlock as any);

        await this.db.put(encodeKey(genesisBlock.index), genesisBlock);

        this.lock.release();

        return genesisBlock;
    };

    /**
     * Add a single block
     *
     * @param  {BlockType} data
     */
    public addBlock = (block: Omit<BlockType, 'hash' | 'previousHash' | 'index' | 'timestamp'>) => new Promise<BlockType>(async (resolve, reject) => {
        await this.lock.acquire();

        const lastBlock = await this.getLastBlock();

        if (!lastBlock) throw new Error('No genesis block found');

        const newBlock: BlockType = {
            ...block,
            hash: '',
            previousHash: lastBlock.hash,
            index: 0,
            timestamp: new Date().getTime(),
        } as any;

        newBlock.index = lastBlock.index + 1;
        newBlock.hash = await this.onHash(newBlock);

        this.db.put(encodeKey(newBlock.index), newBlock, (err) => {
            if (err) reject(err);

            resolve(newBlock);
            this.emitter.emit('blockAdded', newBlock);
        });

        return newBlock;
    });

    /**
     * findBloick by predicate
     *
     * @param  {(value:BlockType,index:number)=>boolean} predicate
     */
    public findBlock = async (predicate: (value: BlockType, index: number) => boolean) => {
        const count = await this.length();
        for (let i = 1; i < count; i++) {
            const block = await this.getBlockByIndex(i);

            if (block) {
                if (predicate(block as BlockType, i)) {
                    return block;
                }
            }
        }

        return null;
    }

    /**
     * Replace Blockchain blocks
     * @param  {BlockType[]} blocks
     */
    public replaceBlockchain = async (blocks: BlockType[]) => {
        await this.lock.acquire();

        const currentBlockchainLen = await this.length();

        if (currentBlockchainLen > blocks.length) {
            throw new Error('The incoming chain must be longer');
        }

        this.isReplacing = true;

        for (const buffer of blocks) {
            if (!await this.validateIncomingBlocks(blocks)) {
                this.lock.release();
                throw new Error('The incoming chain must be valid');
            }

            const block: BlockType = buffer;

            await this.db.put(encodeKey(block.index), buffer);
        }

        this.isReplacing = false;
        this.lock.release();
    }

    /**
     * check if Blockchain is locked for replacing
     * @returns {boolean}
     */
    public replacing() {
        return this.isReplacing;
    }

    /**
     * validate Blockchain data
     * @param  {BlockType[]} blocks
     */
    private validateIncomingBlocks = async (blocks: BlockType[]) => {
        let prevMemBlock: BlockType | null = null;

        for (let i = 0; i < blocks.length; i++) {
            const currentBlock: BlockType = blocks[i];
            const previousBlock: BlockType | null = prevMemBlock || (blocks[i - 1] ? blocks[i - 1] : null);

            if (await this.blockchainingIsInvalid(currentBlock, previousBlock, prevMemBlock)) {
                return false;
            }

            if (currentBlock) {
                prevMemBlock = currentBlock;
            }
        }

        return true;
    }

    /**
     * get decoded block
     * @param  {number} index
     */
    public getBlockByIndex = (index: number) => new Promise<BlockType | null>((resolve) => {
        if (index < 0) {
            resolve(null);
        }
        this.db.get(encodeKey(index), (err, data) => {
            if (err) {
                resolve(null);
            } else {
                resolve(data);
            }
        });
    });

    /**
     * Get entrie decoded Blockchain
     *
     * @param  {} fromIndex=0
     * @param  {} =>newPromise<T[]>((resolve
     * @param  {} reject
     */
    public getBlockchain = async (fromIndex = 0, limit?: number) => new Promise<BlockType[]>((resolve, reject) => {
        const blocks: BlockType[] = [];

        this.db.createReadStream({
            gte: encodeKey(fromIndex),
            ...(limit ? { limit } : {}),
        })
            .on('data', (data) => blocks.push(data.value))
            .on('error', reject)
            .on('close', () => resolve(blocks))
            .on('end', () => resolve(blocks));
    });

    /**
     * @param {number} fromIndex
     */
    public validate = async (fromIndex = 0, onProgress?: (progress: number) => void): Promise<boolean> => {
        const length = await this.length();
        let prevMemBlock: BlockType | null = null;

        for (let i = fromIndex; i < length; i++) {
            const currentBlock = await this.getBlockByIndex(i);
            const previousBlock: any = prevMemBlock || await this.getBlockByIndex(i - 1);

            if (await this.blockchainingIsInvalid(currentBlock, previousBlock, prevMemBlock)) {
                return false;
            }

            if (currentBlock) {
                prevMemBlock = currentBlock;
            }
            if (onProgress) {
                onProgress(((i - fromIndex) / (length - fromIndex)) * 100);
            }
        }

        return true;
    };

    /**
     * @param  {BlockType|null} currentBlock
     * @param  {BlockType|null} previousBlock
     * @param  {BlockType|null} prevMemBlock
     */
    private blockchainingIsInvalid = async (currentBlock: BlockType | null, previousBlock: BlockType | null, prevMemBlock: BlockType | null) => {
        if (currentBlock?.hash !== (currentBlock ? await this.onHash(currentBlock) : null)) {
            return true;
        }

        const isGenesis = (currentBlock as any)?.data?.genesis;

        if (!isGenesis) {
            if (currentBlock?.previousHash !== previousBlock?.hash) {
                return true;
            }

            if (!prevMemBlock || prevMemBlock.timestamp >= currentBlock.timestamp) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  {(block:BlockType,index:number,count:number)=>void} callback
     */
    public forEach = async (callback: (block: BlockType, index: number, count: number) => void) => {
        const count = await this.length();
        for (let i = 0; i < count; i++) {
            const block = await this.getBlockByIndex(i);
            if (block) {
                callback(block, i, count);
            }
        }
    }

    public onReady = (callback: () => void) => {
        this.emitter.on('ready', callback);
    }

    public awaitForDatabaseConnection() {
        return new Promise<void>((resolve) => {
            this.emitter.on('ready', resolve);
        });
    }

    public close = async () => {
        this.emitter.removeAllListeners();
        await this.db.close();
    }
}
