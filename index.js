let hive = require("@hiveio/hive-js")
let fs = require("fs")
let axios = require("axios")
let day = require("dayjs")
let utc = require('dayjs/plugin/utc')
day.extend(utc)

let lastBlockParsed = -1
let accounts = []
let config = {}
let targets = []
let gang = []

hive.api.setOptions({ url: "https://api.deathwing.me/" })

startStreaming()
update()
setInterval(() => {
  update()
}, 1000 * 60)

/**
 * Streams
 * @param {Integer} blockNumber block number to stream
 */
function getBlock(blockNumber) {
  hive.api.getBlock(blockNumber, (errB, resultB) => {
    if (!errB && resultB) {
      if (blockNumber === lastBlockParsed + 1) {
        parseBlock(resultB)
        lastBlockParsed = lastBlockParsed + 1
        setTimeout(() => {
          getBlock(lastBlockParsed + 1)
        }, 0.5 * 1000)
      } else {
        setTimeout(() => {
          getBlock(lastBlockParsed + 1)
        }, 3000)
      }
    } else {
      setTimeout(() => {
        getBlock(blockNumber)
      }, 0.5 * 1000)
    }
  })
}

/**
 * Parses a block and sends to router
 * @param {Object} block Block to parse
 */
function parseBlock(block) {
  if (block.transactions.length !== 0) {
    let trxs = block.transactions
    for (let i in trxs){
      let trx = trxs[i]
      parseTrx(trx)
    }
  }
}

/**
 * Parses a trx
 * @param {Object} transaction
 */
function parseTrx(trx){
  let ops = trx.operations
  for (let i in ops){
    let op = ops[i]
    if (op[0] === "comment"){
      let action = op[1]
      let metadata = {}
      let includesLeoTag = false
      try {
        metadata = JSON.parse(action.json_metadata)
        includesLeoTag = metadata.tags.includes("hive-167922") || metadata.tags.includes("leofinance")
      } catch (e){
        //Do jack shit cuz i don't error hanle
      }
      if (targets.includes(action.author) && action.parent_author === "" && (includesLeoTag || (action.parent_permlink === "hive-167922" || action.parent_permlink === "leofinance"))){
        processLeoPost(action)
      }
    }
  }
}

/**
 * Process's post
 * @param {Object} post post
 */
function processLeoPost(post){
  axios("https://scot-api.steem-engine.com/@rishi556.leo?hive=1").then((result) => {
    let leo_vp = parseInt(result.data.LEO.voting_power) / 100
    let last_vote_time = day.utc(result.data.LEO.last_vote_time).unix()
    let now = day.utc().unix()
    let diff = now - last_vote_time
    leo_vp = leo_vp + (0.00023148148 * diff)
    if (leo_vp >= config.min_vp_vote || gang.includes(post.author)){
      setTimeout(() => {
        for (let i in accounts){
          hive.broadcast.vote(config.posting_key, accounts[i], post.author, post.permlink, config.vote_weight, (err, result) => {
            //Don't do shit either way
          })
        }
      }, 1000 * 60 * 3.5)
    }
  })
}

/**
 * Returns block to start streaming on.
 * @returns Block to start streaming on.
 */
async function getStartStreamBlock() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, result) => {
      if (err) {
        console.log(err)
        return reject(err)
      }
      return resolve(result.last_irreversible_block_num)
    })
  })
}

/**
 * Starts streaming the hive blockchain
 */
async function startStreaming() {
  let startBlock = await getStartStreamBlock()
  lastBlockParsed = startBlock - 1
  getBlock(startBlock)
}

/**
 * Updates all 3 things
 */
function update(){
  fs.readFile("config.json", (err, data) => {
    config = JSON.parse(data.toString())
  })
  fs.readFile("accounts.json", (err, data) => {
    accounts = JSON.parse(data.toString())
  })
  fs.readFile("targets.json", (err, data) => {
    targets = JSON.parse(data.toString())
  })
  fs.readFile("gang.json", (err, data) => {
    gang = JSON.parse(data.toString())
  })
}

