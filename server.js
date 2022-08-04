const express = require("express")
const { Server } = require("socket.io")
const Redis = require("ioredis")
const { setupWorker } = require("@socket.io/sticky")

const cors = require("cors")
const { corsConfig } = require("./corsConfig")

const app = express()
const server = require("http").createServer(app)

const redisClient = new Redis()
const io = new Server(server, {
  cors: corsConfig,
  adapter: require("socket.io-redis")({
    pubClient: redisClient,
    subClient: redisClient.duplicate(),
  }),
})

const crypto = require("crypto")

const randomId = () => crypto.randomBytes(8).toString("hex")
const { RedisSessionStore } = require("./sessionStore")
const sessionStore = new RedisSessionStore(redisClient)
const { RedisMessageStore } = require("./messageStore")
const messageStore = new RedisMessageStore(redisClient)

app.use(cors(corsConfig))

io.use(async (socket, next) => {
  //session ID (private): used to authenticate user upon reconnection
  // username (public) : identifier for exchanging messages
  const sessionID = socket.handshake.auth.sessionID
  if (sessionID) {
    //find existing session
    const session = await sessionStore.findSession(sessionID)
    if (session) {
      socket.sessionID = sessionID
      socket.userID = session.userID
      socket.username = session.username
      return next()
    }
  }
  const username = socket.handshake.auth.username
  if (!username) {
    return next(new Error("invalid username"))
  }
  socket.sessionID = randomId()
  socket.userID = randomId()
  socket.username = username
  next()
})

io.on("connection", async (socket) => {
  //persist session
  sessionStore.saveSession(socket.sessionID, {
    userID: socket.userID,
    username: socket.username,
    connected: true,
  })

  //emit session details
  socket.emit("session", {
    sessionID: socket.sessionID,
    userID: socket.userID,
  })

  // join the "userID" room
  socket.join(socket.userID)

  //fetch existing users
  const users = []
  const [messages, sessions] = await Promise.all([
    messageStore.findMessagesForUser(socket.userID),
    sessionStore.findAllSessions(),
  ])
  const messagesPerUser = new Map()
  messages.forEach((message) => {
    const { from, to } = message
    const otherUser = socket.userID === from ? to : from
    if (messagesPerUser.has(otherUser)) {
      messagesPerUser.get(otherUser).push(message)
    } else {
      messagesPerUser.set(otherUser, [message])
    }
  })

  sessions.forEach((session) => {
    users.push({
      userID: session.userID,
      username: session.username,
      connected: session.connected,
      messages: messagesPerUser.get(session.userID) || [],
    })
  })

  // send existing users to client
  socket.emit("users", users)

  // notify existing users
  socket.broadcast.emit("user connected", {
    userID: socket.userID,
    username: socket.username,
    connected: true,
    messages: [],
  })

  socket.on("private message", ({ content, to }) => {
    const message = {
      content,
      from: socket.userID,
      to,
    }
    socket.to(to).to(socket.userID).emit("private message", message)
    messageStore.saveMessage(message)
  })

  //notify users upon disconnection
  socket.on("disconnect", async () => {
    const matchingSockets = await io.in(socket.userID).allSockets()
    const isDisconnected = matchingSockets.size === 0
    if (isDisconnected) {
      //notify other users
      socket.broadcast.emit("user disconnected", socket.userID)
      // update the connection status of the session
      sessionStore.saveSession(socket.sessionID, {
        userID: socket.userID,
        username: socket.username,
        connected: false,
      })
    }
  })
})

setupWorker(io)
