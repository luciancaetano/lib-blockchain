# lib-Blockchain
Blockchain implementation using leveldb as storage engine.

# Usage

```javascript
import {Blockchain} from 'lib-Blockchain';

// add data attribute to hash calculation
const b = new Blockchain('db-path', ['data']);

b.createGenesisBlock(); // create genesis block
b.addBlock({ data: 'Hello world' });

console.log(b.getBlockchain());
```
