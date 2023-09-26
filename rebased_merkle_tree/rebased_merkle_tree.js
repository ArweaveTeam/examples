#!/usr/bin/env node

// Rebased Merkle Trees
//
// To run this example script:
// 1. npm install --save arweave
// 2. Update HOST, PORT, PROTOCOL, NETWORK, and wallet_path to match your environment
// 3. ./rebased_merkle_tree.js
//
// Note: Although this example script uses arweave-js, the rebasing logic is implemented at
// the Arweave protocol level and can be used with any Arweave client library.
//
// See the README for more infocmation about Merkle Tree Rebasing:
// https://github.com/ArweaveTeam/examples/blob/main/rebased_merkle_tree/README.md
//
// This script starts by building 3 standard Arweave data transactions. It then merges two of
// them using Merkle Tree Rebasing, and the merges the result with the third transaction.
//
// There are 3 main steps to the Merkle Tree Rebasing process:
// 1. merge_and_rebase_merkle_trees(): Create a new data root for the merged tree
// 2. rebase_proof(): Rebase each of the merkle proofs in the merged tree
// 3. rebase_chunk(): Rebase each of the chunks in the merged tree
//
// After merging the 3 regular transactions this script posts the transaction and its chunks
// to the configured Arweave node.
//

var fs = require("fs");
var Arweave = require("arweave");
const { default: Transaction } = require("arweave/node/lib/transaction");
const { intToBuffer } = require("arweave/node/lib/merkle");

const MAX_CHUNK_SIZE = 256 * 1024;
const HASH_SIZE = 32;
const REBASE_MARK = new Uint8Array(HASH_SIZE);
const HOST = "XXX";
const PORT = "1984";
const PROTOCOL = "http"; // or "https"
const NETWORK =  "arweave.N.1";

var arweave = new Arweave({
  host    : HOST,
  port    : PORT,
  protocol: PROTOCOL,
  network : NETWORK
});

var wallet_path = "/path/to/wallet/file.json";
var key = JSON.parse(fs.readFileSync(wallet_path));

function round_to_chunk_size(size) {
  return Math.ceil(size / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
}

// Create a new transaction that contains the merger of the left_transaction and right_transaction
// merkle trees
async function merge_and_rebase_merkle_trees(left_transaction, right_transaction) {
  let left_size = parseInt(left_transaction.data_size);
  let right_size = parseInt(right_transaction.data_size);
  // Normally the right most chunk in a merkle tree can be less that 256KiB. However, once merged,
  // the right most chunk in left_transaction will no longer be the right-most chunk in the
  // merged tree. So we have to pad the tree size out to the next 256KiB boundary.
  let rounded_left_size = round_to_chunk_size(left_size);
  let tree_size = rounded_left_size + right_size;

  // A rebased merkle tree root is a standard merkle tree root
  let data_root = await Arweave.crypto.hash(Arweave.utils.concatBuffers([
    await Arweave.crypto.hash(left_transaction.chunks.data_root),
    await Arweave.crypto.hash(right_transaction.chunks.data_root),
    await Arweave.crypto.hash(intToBuffer(rounded_left_size))
  ]));

  // Create an arweave-js transaction to hold the rebased merkle tree.
  return new Transaction({
    last_tx: await arweave.transactions.getTransactionAnchor(),
    reward: await arweave.transactions.getPrice(tree_size),
    data_size: tree_size.toString(),
    data_root: Arweave.utils.bufferTob64Url(data_root),
    chunks: {
      data_root: data_root,
      chunks: [],
      proofs: []
    }
  });
}

// Preped a rebased merkle proof element to the existing proof from one of the subtrees.
async function rebase_proof(
  merged_transaction, left_data_root, right_data_root, left_size, left_bound_shift, proof) {
    // REBASE_MARK is a 32-byte 0-value that indicates all merkle proof elements after it
    // are rebased. The offset values in those merkle proof elements should be shifted by
    // some amount. Elements in the left substree are not shifted, elements in the right subtree
    // are shifted by the rounded left-tree size (i.e. `round_to_chunk_size(left_size)`))
    // Note: this shifting is applied automatically by the Arweave node when it validates the proof.
    let rebased_proof = Arweave.utils.concatBuffers([
      REBASE_MARK,
      left_data_root,
      right_data_root,
      intToBuffer(round_to_chunk_size(left_size)),
      proof.proof
    ]);

    merged_transaction.chunks.proofs.push({
      proof: rebased_proof,
      offset: left_bound_shift + proof.offset,
    });
}

// Update the start/end offsets of the *data* offsets for each chunk in the merged tree. The
// data offsets differ slightly from the merkle proof offsets since the data array is compacted
// (i.e. the data array does not include the chunk-size rounding that we applied to the
// Merkle proofs)
async function rebase_chunk(merged_transaction, data_buffer_shift, chunk) {
  chunk.minByteRange = data_buffer_shift + chunk.minByteRange;
  chunk.maxByteRange = data_buffer_shift + chunk.maxByteRange;
  merged_transaction.chunks.chunks.push(chunk);
}

// Comact the data arrays from the left and right transactions, and rebase each chunk and proof
async function rebase_proofs(merged_transaction, left_transaction, right_transaction) {
  merged_transaction.data = Arweave.utils.concatBuffers([
    left_transaction.data, right_transaction.data]);

  let left_data_root = left_transaction.chunks.data_root;
  let right_data_root = right_transaction.chunks.data_root;
  let left_size = parseInt(left_transaction.data_size);

  for (let i = 0; i < left_transaction.chunks.proofs.length; i++) {
    let data_buffer_shift = 0;
    await rebase_chunk(merged_transaction, data_buffer_shift, left_transaction.chunks.chunks[i]);

    let left_bound_shift = 0;
    await rebase_proof(merged_transaction,
      left_data_root, right_data_root, left_size, left_bound_shift, 
      left_transaction.chunks.proofs[i]);
  }
  for (let i = 0; i < right_transaction.chunks.proofs.length; i++) {
    let data_buffer_shift = left_transaction.data.byteLength;
    await rebase_chunk(merged_transaction, data_buffer_shift, right_transaction.chunks.chunks[i]);

    let left_bound_shift = round_to_chunk_size(left_size);
    await rebase_proof(merged_transaction,
      left_data_root, right_data_root, left_size, left_bound_shift,
      right_transaction.chunks.proofs[i]);
  }
}

// Helper function to post each of the chunks to the arweave node. There is nothing about this
// function that is specific to rebased trees.
async function post_chunks(transaction) {
  for (let i = 0; i < transaction.chunks.chunks.length; i++) {
    let proof = transaction.chunks.proofs[i].proof;
    let offset = transaction.chunks.proofs[i].offset;
    let chunk = transaction.chunks.chunks[i];
    let chunk_data = transaction.data.slice(chunk.minByteRange, chunk.maxByteRange);
    let payload = {
        data_root: transaction.data_root,
        data_size: transaction.data_size,
        data_path: Arweave.utils.bufferTob64Url(proof),
        offset: offset.toString(),
        chunk: Arweave.utils.bufferTob64Url(chunk_data),
      };
     let response = await arweave.api.post('chunk', payload);
     console.log("POST chunk " + i + ": " + response.status);
  }
}

(async function(){
  // Create 3 standard Arweave data transactions with standard merkle trees
  let transaction1 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_474000.txt')
  });
  let transaction2 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_120000.txt')
  });
  let transaction3 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_524288.txt')
  });

  // merged_transaction1 = rebased merge of transaction1 and transaction2
  let merged_transaction1 = await merge_and_rebase_merkle_trees(transaction1, transaction2);
  await rebase_proofs(merged_transaction1, transaction1, transaction2);

  // merged_transaction2 = rebased merge of merged_transaction1 and transaction3
  let merged_transaction2 = await merge_and_rebase_merkle_trees(merged_transaction1, transaction3);

  // Sign and post the merged transaction before rebasing the chunks and proofs. This ordering
  // is only needed to avoid some code in the arweave-js implementation that has not yet been
  // updated to handle rebased merkle trees. There is nothing in the protocol that requires
  // the transaction to be posted before the chunks and proofs are rebased.
  await arweave.transactions.sign(merged_transaction2, key);
  let response = await arweave.api.post('tx', merged_transaction2);
  console.log("POST tx " + merged_transaction2.id + ": " + response.status);

  // Rebase the chunks and proof and post them.
  await rebase_proofs(merged_transaction2, merged_transaction1, transaction3);
  await post_chunks(merged_transaction2);

  console.log(PROTOCOL + "://" + HOST + ":" + PORT + "/tx/" + merged_transaction2.id);
})()

