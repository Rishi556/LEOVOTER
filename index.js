let hive = require("@hiveio/hive-js")
let fs = require("fs")
let axios = require("axios")
let day = require("dayjs")
let logger = require("node-color-log")
let utc = require('dayjs/plugin/utc')
day.extend(utc)

let accounts = []
let config = {}
let targets = []
let gang = []

let errorCount = 0
let currentNode = ""
let nodes = []

startStreaming()
update(true)
setInterval(() => {
  update(false)
}, 1000 * 60)

/**
 * Streams
 * @param {Integer} blockNumber block number to stream
 */
function getBlock(blockNumber) {
  let nextBlock = false
  axios.post(currentNode, { "id": blockNumber, "jsonrpc": "2.0", "method": "call", "params": ["condenser_api", "get_block", [blockNumber]] }).then((res) => {
    if (res.data.result){
      logger.info(`Got data for block ${blockNumber} processing now`)
      let block = res.data.result
      nextBlock = true
      parseBlock(block)
      errorCount = 0 //We are resetting to 0 because we want 3 consecutive fails to switch
    }
  }).catch((err) => {
    logger.error(`Error for block ${blockNumber} trying again in 3 seconds`)
  }).finally(() => {
    if (nextBlock){
      setTimeout(() => {
        getBlock(blockNumber + 1)
      }, 0.5 * 1000)
    } else {
      nodeError()
      setTimeout(() => {
        getBlock(blockNumber)
      }, 3 * 1000)
    }
  })
}

/**
 * Handles if a node errors out. Not all error types get added here, only node not returning data. On config.node_error_switch errors, it changes nodes.
 */
function nodeError() {
  errorCount++
  logger.warn(`${currentNode} has suffered ${errorCount} errors in a row, at ${config.node_error_switch} it will switch over to the next one`)
  if (errorCount === config.node_error_switch) {
    errorCount = 0
    currentNode = nodes.shift()
    logger.info(`Switching node to ${currentNode}`)
    hive.api.setOptions({ url: currentNode })
    nodes.push(currentNode)
  }
}

/**
 * Parses a block and sends to router
 * @param {Object} block Block to parse
 */
function parseBlock(block) {
  if (block.transactions.length !== 0) {
    let trxs = block.transactions
    for (let i in trxs) {
      let trx = trxs[i]
      parseTrx(trx)
    }
  }
}

/**
 * Parses a trx
 * @param {Object} transaction
 */
function parseTrx(trx) {
  let ops = trx.operations
  for (let i in ops) {
    let op = ops[i]
    if (op[0] === "comment") {
      let action = op[1]
      let metadata = {}
      let includesLeoTag = false
      try {
        metadata = JSON.parse(action.json_metadata)
        includesLeoTag = metadata.tags.includes("hive-167922") || metadata.tags.includes("leofinance")
      } catch (e) {
        //Not handling it but should probably
      }
      if (targets.includes(action.author) && action.parent_author === "" && (includesLeoTag || (action.parent_permlink === "hive-167922" || action.parent_permlink === "leofinance"))) {
        processLeoPost(action)
        logger.info(`Found leo post by ${action.author} with permlink ${action.permlink}. Processing it now`)
      }
    }
  }
}

/**
 * Process's post
 * @param {Object} post post
 */
function processLeoPost(post) {
  axios("https://scot-api.steem-engine.com/@rishi556.leo?hive=1").then((result) => {
    let leo_vp = parseInt(result.data.LEO.voting_power) / 100
    let last_vote_time = day.utc(result.data.LEO.last_vote_time).unix()
    let now = day.utc().unix()
    let diff = now - last_vote_time
    leo_vp = leo_vp + (0.00023148148 * diff) //This is not exact but is close enough that we don't care
    logger.info(`Leo VP is about ${leo_vp.toFixed(2)}, will only vote if above 80% or author is part of the gang`)
    if (leo_vp >= config.min_vp_vote || gang.includes(post.author)) {
      logger.info(`Have enough VP for voting. Will proceed in ${config.vote_delay_min} minutes`)
      setTimeout(() => {
        for (let i in accounts) {
          hive.broadcast.vote(config.posting_key, accounts[i], post.author, post.permlink, config.vote_weight, (err, result) => {
            if (err) {
              logger.error(`Error voting leo post by ${post.author} with permlink ${post.permlink}`)
              nodeError()
              return
            }
            logger.info(`Voted on leo post by ${post.author} with permlink ${post.permlink} with account ${accounts[i]}`)
          })
        }
      }, 1000 * 60 * config.vote_delay_min)
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
  getBlock(startBlock)
}

/**
 * Updates all 3 things
 */
function update(isFirst) {
  fs.readFile("config.json", (err, data) => {
    config = JSON.parse(data.toString())
    if (isFirst) {
      logger.setLevel(config.log_level)
      nodes = config.hive_nodes
      currentNode = nodes.shift()
      hive.api.setOptions({ url: currentNode })
      nodes.push(currentNode)
      logger.info(`Initial node is set to ${currentNode}`)
    }
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

