import crypto from 'crypto';
import level from 'level';
import { EventEmitter } from 'events';
import { LockMutex } from '../Mutex/LockMutex';
import { Block, GenesisBlock } from './types';

const encodeKey = (key: number) => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(key, 0);
    return buffer;
};

export class Blockchain<BlockType extends Block> {
    private db: level.LevelDB;

    private emitter = new EventEmitter();

    private lock: LockMutex;

    public static encode = (json: any): Buffer => Buffer.from(JSON.stringify(json));

    public static decode = (buffer: Buffer): any => JSON.parse(buffer.toString('utf-8'));

    private isReplacing: boolean;

    private hashAttrs: string[];

    /**
     * @constructor
     * @param  {string} dbPath
     */
    constructor(dbPath: string, hashAttrs: string[]) {
        this.db = level(dbPath, { valueEncoding: 'binary', keyEncoding: 'binary' }, (err) => {
            if (err) {
                throw err;
            } else {
                this.emitter.emit('ready');
            }
        });

        this.lock = new LockMutex();
        this.hashAttrs = hashAttrs;

        this.isReplacing = false;
    }

    /**
     * Calculate block hash
     *
     * @param  {BlockType} block
     */
    private calculateBlockHash = (block: BlockType) => {
        const hashTarget: any = {
            index: block.index,
            previousHash: block.previousHash,
            timestamp: block.timestamp,
        };

        this.hashAttrs.forEach((prop) => {
            hashTarget[prop] = (block as any)[prop];
        });

        const data = Blockchain.encode(hashTarget);

        const hash = crypto.createHash('sha256');

        hash.update(data);

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
                        resolve(Blockchain.decode(block));
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

        genesisBlock.hash = this.calculateBlockHash(genesisBlock as any);

        await this.db.put(encodeKey(genesisBlock.index), Blockchain.encode(genesisBlock));

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
        newBlock.hash = this.calculateBlockHash(newBlock);

        this.db.put(encodeKey(newBlock.index), Blockchain.encode(newBlock), (err) => {
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
     * @param  {Buffer[]} binaryBlocks
     */
    public replaceBlockchain = async (binaryBlocks: Buffer[]) => {
        await this.lock.acquire();

        const currentBlockchainLen = await this.length();

        if (currentBlockchainLen > binaryBlocks.length) {
            throw new Error('The incoming chain must be longer');
        }

        this.isReplacing = true;

        for (const buffer of binaryBlocks) {
            if (!await this.validateBinaryBlockchain(binaryBlocks)) {
                this.lock.release();
                throw new Error('The incoming chain must be valid');
            }

            const block: BlockType = Blockchain.decode(buffer);

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
     * validate binary Blockchain data
     * @param  {Buffer[]} binaryBlocks
     */
    private validateBinaryBlockchain = async (binaryBlocks: Buffer[]) => {
        let prevMemBlock: BlockType | null = null;

        for (let i = 0; i < binaryBlocks.length; i++) {
            const currentBlock: BlockType = Blockchain.decode(binaryBlocks[i]);
            const previousBlock: BlockType | null = prevMemBlock || (binaryBlocks[i - 1] ? Blockchain.decode(binaryBlocks[i - 1]) : null);

            if (await this.BlockchainingIsInvalid(currentBlock, previousBlock, prevMemBlock)) {
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
        this.getBinaryBlockByIndex(index).then((buff) => {
            if (buff) {
                resolve(Blockchain.decode(buff));
                return;
            }
            resolve(null);
        });
    });

    /**
     * Get block buffer
     * @param  {number} index
     */
    public getBinaryBlockByIndex = (index: number) => new Promise<Buffer | null>((resolve) => {
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
            .on('data', (data) => blocks.push(Blockchain.decode(data.value)))
            .on('error', reject)
            .on('close', () => resolve(blocks))
            .on('end', () => resolve(blocks));
    });

    /**
     * interates over Blockchain and get buffers
     *
     * @param  {} fromIndex=0
     * @param  {(block:Buffer,index:number,count:number)=>void} callback
     */
    public getBinaryBlockchain = async (fromIndex = 0, callback: (block: Buffer, index: number, count: number) => void) => {
        const count = await this.length();
        for (let i = fromIndex; i < count; i++) {
            const block = await this.getBinaryBlockByIndex(i);
            if (block) {
                callback(block, i, count);
            }
        }
    }

    /**
     * @param {number} fromIndex
     */
    public validate = async (fromIndex = 0, onProgress?: (progress: number) => void): Promise<boolean> => {
        const length = await this.length();
        let prevMemBlock: BlockType | null = null;

        for (let i = fromIndex; i < length; i++) {
            const currentBlock = await this.getBlockByIndex(i);
            const previousBlock: any = prevMemBlock || await this.getBlockByIndex(i - 1);

            if (await this.BlockchainingIsInvalid(currentBlock, previousBlock, prevMemBlock)) {
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
    private BlockchainingIsInvalid = async (currentBlock: BlockType | null, previousBlock: BlockType | null, prevMemBlock: BlockType | null) => {
        if (currentBlock?.hash !== (currentBlock ? this.calculateBlockHash(currentBlock) : null)) {
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
    public eachBlock = async (callback: (block: BlockType, index: number, count: number) => void) => {
        const count = await this.length();
        for (let i = 0; i < count; i++) {
            const block = await this.getBlockByIndex(i);
            if (block) {
                callback(block, i, count);
            }
        }
    }

    /**
     * @param  {(block:BlockType)=>void} callback
     */
    public onBlockAdded = (callback: (block: BlockType) => void) => {
        this.emitter.on('blockAdded', callback);
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
