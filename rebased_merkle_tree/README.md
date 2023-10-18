# Rebased Merkle Trees

Prior to Arweave 2.7 if you wanted to combine the data from 2 different Merkle Trees you had to rebuild a new Merkle Tree and its Merkle Proofs from scratch. Starting in Arweave 2.7 you can use Merkle Tree Rebasing to allow merging multiple merkle trees without rebuilding any of them. This document provides an overview of the rebasing logic and format.

[rebased_merkle_tree.js](https://github.com/ArweaveTeam/examples/blob/main/rebased_merkle_tree/rebased_merkle_tree.js) provides example javascript code.

## Building a standard (non-rebased) Merkle Tree and its Proofs

Each Arweave data transaction includes a **data root** representing a **Merkle Tree** whose leaf nodes are the data chunks associated with that transaction. This structure allows us to submit and confirm lightweight transactions which **don't** include any data, and then later submit all the data (which can take some time depending on the amount of data to be uploaded to the network).

Since we submit the data separately from the transaction we need a way to prove that the submitted chunk does in fact belong to the specified transaction. **Merkle Proofs** cryptographically trace the path from the data chunk, up through the Merkle Tree, to the data root. A Merkle Proof will only validate when the data chunk used in the proof is the same one that was used when the original Merkle Tree was constructed.

![Building A Merkle Tree](https://github.com/ArweaveTeam/examples/assets/3465100/ca060573-f723-4462-949a-7cc0c61775c7)

### Building a Merkle Tree:
1. Divide your data into 256KiB chunks and lay them out end-to-end
2. Each transaction sequences its data chunks using byte-offsets starting from 0 up through the total size of all the data associated with the transaction
3. Each node in a merkle tree has an **id**. The lowest level nodes (**leaf nodes**) are directly associated with data chunks. A leaf node id is formed by:
   1. Taking the **double-hash** of the associated chunk data (i.e. the SHA256 hash of the SHA256 hash of the chunk data)
   2. Taking the hash of the **right-most** offset of the chunk data. A chunk that is sequenced to start at byte-offset 0 and run through byte-offset 262,144 will have a Merkle Tree offset of **262,144**.
4. Each subsequent level of a Merkle Tree is formed by adding a parent to two sibling nodes in the previous (lower) level. These parents are **branch nodes**. The top-most branch node is the Merkle Tree's **data root**. A branch node id is formed by:
   1. Taking the hash of the left-child id
   2. Taking the hash of the right-child id
   3. Taking the hash of the highest offset found in the left-child's subtree. This value will be used when validating Merkle Proofs to determine whether a given node is a left or right child of its parent.
  
### Building Merkle Proofs:
A Merkle Proof is a path through the Merkle Tree from a leaf node up to the data root. Each data chunk in a transaction has its own Merkle Proof. You can think of each node in a Merkle Proof being the **unhashed** version of the equivalent node in the Merkle Tree. The Merkle Proof for **chunk2** is formed by:

1. **Unhashing id2 (a leaf node)**: Merkle Proof leaf nodes are the **single-hash** of the chunk data concatenated with the **unhashed** Merkle Offset of that data chunk.
2. **Unhashing id3 (a branch node and the data root)**: Merkle Proof branch nodes are the unhashed version of their Merkel Tree node. In this case: **id1** concatenated to **id2** concatenated to right-most offset of the tree rooted in **id1**

Once complete the Merkle Proof forms a complete path from the Data Chunk up through the Merkle Tree to the data root. This example tree is small and so the proofs are trivial, but the same process and logic applies to much larger trees with thousands of data chunks.


## 2 Merkle Trees

In the following sections we will walk through how to merge these two Merkle Trees:
![Rebased Merkle Trees](https://github.com/ArweaveTeam/examples/assets/3465100/2a6704d2-4a61-4774-a083-997beb3d9230)

The tree rooted in **id1** has 1 chunk and its 0-based data-space runs from 0 to 262,144. The tree rooted in **id4** has 2 chunks and its 0-based data-space runs from 0 to 524,288.


## Merging without rebasing

![Merging Without Rebasing](https://github.com/ArweaveTeam/examples/assets/3465100/d68fa535-004f-4090-9791-1e2c24f7320d)

1. Resequence the chunks from each tree so that they all lie in the same 0-based data-space.
   1. For example: move **chunk2** from offset **262,144** to offset **524,288**, and move **chunk3** from offset **524,288** to offset **786,432**
2. For any chunk that was moved, recompute the ids of all nodes above it in the Merkle Tree
3. Add the new, merged, data root.
4. Recompute the Merkle Proofs for the new Merkle Tree

The items in red need to be recomputed in order to build the new, merged tree. In a trivial example like this there aren't that many values to update - but in a tree with thousands or hundreds of thousands of chunks, a significant number of hashes may need to be recomputed.

## Merging with rebasing

Arweave 2.7 introduces a new Merkle Proof attribute to indicate that a subtree root is **rebased**. A rebased subtree is treated like a full merkle tree for the purposes of calculating chunk offsets - i.e. the left-most chunk under that subtree is considered to be placed at index **0** within its data-offset space.

![Merging With Rebasing](https://github.com/ArweaveTeam/examples/assets/3465100/1836d85f-50da-405c-8de6-2b6b3669241b)

1. There is no need to recompute any of the existing nodes in either Merkle Tree or any of the Merkle Proofs - we can move straight to adding the new data root.
2. Compute a new data root for the Merkle tree as normal.
3. Add a new root node to each Merkle Proof. This new root node is a **rebased** node and is marked by **prepending a 32-byte 0-value**. When the protocol validates that merkle proof it will know that the 2 children of the marked root are rebased subtrees and will shift the offsets of the chunks underneath that subtrees accordingly.

As you can see in the above diagram, this change allows two merkle trees to be merged without recomputing any of their nodes or merkle proofs. The only work is the incremental effort of adding a new merkle tree root, and single merkle proof element for each chunk.

## Nesting rebased trees

![Nesting Rebased Trees](https://github.com/ArweaveTeam/examples/assets/3465100/2b45719b-c53f-44f8-b190-aca25aaf1911)

Rebased merkle trees can be combined with non-rebased merkle trees or other rebased trees. The process is the same:
1. Add a merkle root as normal
2. Prepend a rebased merkle proof element to each of the chunk proofs
