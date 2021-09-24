import { EventEmitter } from 'events';

export class LockMutex {
    private locked: boolean;

    private emitter: EventEmitter;

    constructor() {
        this.locked = false;
        this.emitter = new EventEmitter();
    }

    public acquire() {
        return new Promise<void>((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
                return;
            }

            const tryAcquire = () => {
                if (!this.locked) {
                    this.locked = true;
                    this.emitter.removeListener('release', tryAcquire);
                    resolve();
                }
            };
            this.emitter.on('release', tryAcquire);
        });
    }

    public release() {
        this.locked = false;
        setImmediate(() => this.emitter.emit('release'));
    }
}
