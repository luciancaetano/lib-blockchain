export interface Block {
    // The index of the block
    index: number;

    // The hash of the previous block
    hash: string;

    // The hash of the current block
    previousHash: string;

    // The time of the block
    timestamp: number;
}

export interface GenesisBlock extends Block {
    data: {
        genesis: boolean;
    }
}

export type OnHashFunction<T> = (block: T) => Promise<string>;
