# lib-Blockchain
Blockchain implementation using leveldb as storage engine.

# Usage

```javascript
import {Blockchain} from 'lib-Blockchain';

const b = new Blockchain('db-path');

b.genesis(); // create genesis block
b.push({ data: Buffer.from('Hello world', 'utf-8') });

console.log(b.toArray());
```
