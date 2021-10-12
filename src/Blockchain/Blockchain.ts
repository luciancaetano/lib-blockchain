import crypto from 'crypto';
import level from 'level';
import { Block, OnValidateType } from './types';

const uint2b = (num: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(num, 0);
    return buffer;
};

const uint642b = (num: number) => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(num), 0);
    return buffer;
};

const encodeBlock = (block: Block): Buffer => {
    const chunks: Buffer[] = [];

    chunks.push(uint2b(block.index));
    chunks.push(uint642b(block.timestamp));
    chunks.push(Buffer.from(block.hash, 'hex'));
    chunks.push(Buffer.from(block.previousHash, 'hex'));
    chunks.push(uint642b(block.data.length));
    chunks.push(block.data);

    return Buffer.concat(chunks);
};

const decodeBlock = (buffer: Buffer): Block => {
    const dataLength = Number(buffer.readBigUInt64BE(76));

    const block: Block = {
        index: buffer.readInt32BE(0),
        timestamp: Number(buffer.readBigUInt64BE(4)),
        hash: buffer.slice(12, 44).toString('hex'),
        previousHash: buffer.slice(44, 76).toString('hex'),
        data: '' as any,
    };

    block.data = buffer.slice(84, 84 + dataLength);

    return block;
};

const calculateBlockHash = async (block: Block) => {
    const hash = crypto.createHash('sha256');

    const buffer: Buffer = Buffer.concat([
        uint2b(block.index),
        uint642b(block.timestamp),
        Buffer.from(block.previousHash, 'hex'),
        block.data,
    ]);

    hash.update(buffer);

    return hash.digest('hex');
};

export class Blockchain {
    private db: level.LevelDB;

    private isReplacing: boolean;

    private isReady = false;

    private isLocked = false;

    private onValidateFn: OnValidateType | null = null;

    /**
     * @constructor
     * @param  {string} dbPath
     */
    constructor(dbPath: string, private genesisData = Buffer.from('=====>blockchain-genesis-block<=====')) {
        this.db = level(dbPath, { valueEncoding: 'binary', keyEncoding: 'binary' }, (err) => {
            if (err) {
                throw err;
            } else {
                this.isReady = true;
            }
        });

        this.isReplacing = false;
    }

    /**
     * Get blocks count
     *
     * @param  {} =>newPromise<number>((resolve
     * @param  {} reject
     */
    public length = () => new Promise<number>((resolve, reject) => {
        let count = 0;

        this.db.createKeyStream({
            gte: uint2b(0),
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
    public getLastBlock = () => new Promise<Block | null>((resolve, reject) => {
        this.length().then((count) => {
            if (count === 0) {
                resolve(null);
            } else {
                this.db.get(uint2b(count - 1), (err, block) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(decodeBlock(block));
                    }
                });
            }
        });
    });

    /**
     * Creates the genesis block
     */
    public genesis = async (): Promise<Block | null> => {
        await this.acquire();

        if (await this.getLastBlock()) {
            return null;
        }

        const genesisBlock: Block = {
            data: this.genesisData,
            hash: '',
            index: 0,
            previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
            timestamp: new Date().getTime(),
        };

        genesisBlock.hash = await calculateBlockHash(genesisBlock as any);

        await this.db.put(uint2b(genesisBlock.index), encodeBlock(genesisBlock));

        this.release();

        return genesisBlock;
    };

    /**
     * Add a single block
     *
     * @param  {Block} data
     */
    public push = (block: Omit<Block, 'index' | 'hash' | 'previousHash' | 'timestamp'>) => new Promise<Block>((resolve, reject) => {
        this.acquire().then(() => {
            this.getLastBlock().then((lastBlock) => {
                if (!lastBlock) throw new Error('No genesis block found');

                const newBlock: Block = {
                    ...block,
                    hash: '',
                    previousHash: lastBlock.hash,
                    index: 0,
                    timestamp: new Date().getTime(),
                } as any;

                newBlock.index = lastBlock.index + 1;

                calculateBlockHash(newBlock).then((hash) => {
                    newBlock.hash = hash;
                    this.db.put(uint2b(newBlock.index), encodeBlock(newBlock), (err) => {
                        if (err) reject(err);
                        resolve(newBlock);
                    });
                }).catch(reject);
            }).catch(reject);
        }).catch(reject);
    });

    /**
     * findBloick by predicate
     *
     * @param  {(value:Block,index:number)=>boolean} predicate
     */
    public find = async (predicate: (value: Block, index: number) => boolean) => {
        const count = await this.length();
        for (let i = 1; i < count; i++) {
            const block = await this.at(i);

            if (block) {
                if (predicate(block as Block, i)) {
                    return block;
                }
            }
        }

        return null;
    };

    /**
     * Replace Blockchain blocks
     * @param  {Block[]} blocks
     */
    public replace = async (blocks: Block[]) => {
        await this.acquire();

        const currentBlockchainLen = await this.length();

        if (currentBlockchainLen > blocks.length) {
            throw new Error('The incoming chain must be longer');
        }

        this.isReplacing = true;

        for (const buffer of blocks) {
            if (!await this.validateReplacingBlocks(blocks)) {
                this.release();
                throw new Error('The incoming chain must be valid');
            }

            const block: Block = buffer;

            await this.db.put(uint2b(block.index), encodeBlock(buffer));
        }

        this.isReplacing = false;
        this.release();
    };

    /**
     * check if Blockchain is locked for replacing
     * @returns {boolean}
     */
    public replacing() {
        return this.isReplacing;
    }

    /**
     * get decoded block
     * @param  {number} index
     */
    public at = (index: number) => new Promise<Block | null>((resolve) => {
        if (index < 0) {
            resolve(null);
        }
        this.db.get(uint2b(index), (err, data) => {
            if (err) {
                resolve(null);
            } else {
                resolve(decodeBlock(data));
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
    public toArray = async (fromIndex = 0, limit?: number) => new Promise<Block[]>((resolve, reject) => {
        const blocks: Block[] = [];

        this.db.createReadStream({
            gte: uint2b(fromIndex),
            ...(limit ? { limit } : {}),
        })
            .on('data', (data) => blocks.push(decodeBlock(data.value)))
            .on('error', reject)
            .on('close', () => resolve(blocks))
            .on('end', () => resolve(blocks));
    });

    /**
     * @param {number} fromIndex
     */
    public validate = async (fromIndex = 0, onProgress?: (progress: number) => void): Promise<boolean> => {
        const length = await this.length();
        let prevMemBlock: Block | null = null;

        for (let i = fromIndex; i < length; i++) {
            const currentBlock = await this.at(i);
            const previousBlock: any = prevMemBlock || await this.at(i - 1);

            if (await this.performValidation(currentBlock, previousBlock, prevMemBlock)) {
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
     * @param  {(block:Block,index:number,count:number)=>void} callback
     */
    public forEach = async (callback: (block: Block, index: number, count: number) => void) => {
        const count = await this.length();
        for (let i = 0; i < count; i++) {
            const block = await this.at(i);
            if (block) {
                callback(block, i, count);
            }
        }
    };

    public onValidate = (callback: OnValidateType | null) => {
        this.onValidateFn = callback;
    };

    // wait for isReady be true using timer
    public waitDbOpen = () => new Promise<void>((resolve) => {
        const timer = setInterval(() => {
            if (this.isReady) {
                clearInterval(timer);
                resolve();
            }
        }, 100);
    });

    /**
     * validate Blockchain data
     * @param  {Block[]} blocks
     */
    private validateReplacingBlocks = async (blocks: Block[]) => {
        let prevMemBlock: Block | null = null;

        for (let i = 0; i < blocks.length; i++) {
            const currentBlock: Block = blocks[i];
            const previousBlock: Block | null = prevMemBlock || (blocks[i - 1] ? blocks[i - 1] : null);

            if (await this.performValidation(currentBlock, previousBlock, prevMemBlock)) {
                return false;
            }

            if (currentBlock) {
                prevMemBlock = currentBlock;
            }
        }

        return true;
    };

    /**
     * @param  {Block|null} currentBlock
     * @param  {Block|null} previousBlock
     * @param  {Block|null} prevMemBlock
     */
    private performValidation = async (currentBlock: Block | null, previousBlock: Block | null, prevMemBlock: Block | null) => {
        if (currentBlock?.hash !== (currentBlock ? await calculateBlockHash(currentBlock) : null)) {
            return true;
        }

        const isGenesis = currentBlock.data.compare(this.genesisData) === 0;

        if (!isGenesis) {
            if (currentBlock?.previousHash !== previousBlock?.hash) {
                return true;
            }

            if (!prevMemBlock || prevMemBlock.timestamp >= currentBlock.timestamp) {
                return true;
            }

            if (this.onValidateFn) {
                if (!await this.onValidateFn(currentBlock)) {
                    return true;
                }
            }
        }

        return false;
    };

    private acquire = () => new Promise<void>((resolve) => {
        const timer = setInterval(() => {
            if (!this.isLocked) {
                clearInterval(timer);
                resolve();
            }
        }, 100);
    });

    private release = () => {
        this.isLocked = false;
    };

    public close = async () => {
        await this.db.close();
    };
}
