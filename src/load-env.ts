// Loads `.env.local` first, then `.env`.
//
// `import 'dotenv/config'` reads only `.env`. Every entry point here used that
// while the README told people to put their config in `.env.local`, so a
// correctly configured machine silently ran with no webhook and no database —
// the scan "succeeded" and told nobody. Caught by the first live Discord test.
//
// `.env.local` wins because it is the gitignored file holding real secrets;
// `.env` is for values safe to commit.

import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });
