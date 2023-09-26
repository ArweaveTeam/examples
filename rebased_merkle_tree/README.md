# Rebased Merkle Trees

Prior to Arweave 2.7 if you wanted to combine the data from 2 different merkle trees you had to rebuild a new merkle tree and its merkle proofs from scratch. Starting in Arweave 2.7 you can use Merkle Tree Rebasing to allow merging multiple merkle trees without rebuilding any of them. This document provides an overview of the rebasing logic and format.

[rebased_merkle_tree.js](https://github.com/ArweaveTeam/examples/blob/main/rebased_merkle_tree/rebased_merkle_tree.js) provides example javascript code.

## Start with 2 regular merkle trees

![Regular Merkle Trees](https://github.com/ArweaveTeam/examples/assets/3465100/6a59c9b1-fb82-4e48-8fbf-6f67ffe2f662)
**id1** and **id4** are the data roots for two independent merkle trees. **h()** is shorthand for **"take the sha256 hash of"**

## Merging without rebasing

![Merging Without Rebasing](https://github.com/ArweaveTeam/examples/assets/3465100/d68fa535-004f-4090-9791-1e2c24f7320d)
When merging the two trees without rebasing, the data offsets of the chunks within each tree need to synced up. For example, **chunk2** is no longer located at offset **262,144**, it's now been moved until right after **chunk1** at offset **524,288**. When the offsets of **chunk2** and **chunk3** change it causes a cascade updates up the merkle tree - which in turn forces updates to the merkle prrofs.

In a trivial example like this, the work is small, but in a tree with thousands or hundreds of thousands of chunks, a significant number of hashes may need to be recomputed.

## Merging with rebasing

![Merging With Rebasing](https://github.com/ArweaveTeam/examples/assets/3465100/1836d85f-50da-405c-8de6-2b6b3669241b)
Arweave 2.7 introduces a new merkle proof attribute to indicate that a subtree root is "rebased". A rebased subtree is treated like a full merkle tree for the purposes of calculating chunk offsets - i.e.  the left-most chunk under that subtree is considered to be placed at index **0** within the data-offset space.

To mark a rebased subtree, prepend a 32-byte 0-value to the merkle proof element of the new tree root. When the protocol validates that merkle proof it will know that the 2 children of the marked root are rebased subtrees and will shift the offsets of the chunks underneath that subtrees accordingly.

As you can see in the above diagram, this change allows two merkle trees to be merged without recomputing any of their nodes or merkle proofs. The only work is the incremental effort of adding a new merkle tree root, and single merkle proof element for each chunk.

## Nesting rebased trees

![Nesting Rebased Trees](https://github.com/ArweaveTeam/examples/assets/3465100/2b45719b-c53f-44f8-b190-aca25aaf1911)

Rebased merkle trees can be combined with non-rebased merkle trees or other rebased trees. The process is the same:
1. Add a merkle root as normal
2. Prepend a rebased merkle proof element to each of the chunk proofs
