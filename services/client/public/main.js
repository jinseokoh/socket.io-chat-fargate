var socket = io()

Vue.component("virtual-list", VirtualScrollList)

var store = {
  data: {
    state: {
      username: null,
      authenticated: false,
      avatar: null,
      activeRoom: "general",
      belowMessagesView: "login",
      presentCount: 0,
    },

    activeRoom: {},
    activeMessages: [],

    messages: {
      general: [],
      ecs: [],
      eks: [],
      fargate: [],
    },

    rooms: [],

    events: [],
  },

  // Mutate the data store to add a message
  liveMessage: function (message) {
    this.insertMessage(message)

    if (message.room !== this.data.state.activeRoom) {
      // Message arrive in another room, so need to trigger the dot on that room
      var arrivedRoom = this.data.rooms.find(function (room) {
        return room.id === message.room
      })

      arrivedRoom.status = "unread"
    }
  },

  insertMessage: function (message) {
    var inserted = false

    var messageCount = this.data.messages[message.room].length

    console.log("insert #1")

    if (messageCount === 0) {
      // Insert into empty store.
      this.data.messages[message.room].push(message)
      return
    }

    console.log("insert #2")

    if (messageCount === 1) {
      // Insert second message
      if (message.time > this.data.messages[message.room][0].time) {
        this.data.messages[message.room].push(message)
        return
      } else {
        this.data.messages[message.room].unshift(message)
        return
      }
    }

    console.log("insert #3")

    var last = this.data.messages[message.room][messageCount - 1]

    if (last.time < message.time) {
      // Optimize adding new latest message
      this.data.messages[message.room].push(message)
      return
    }

    console.log("insert #4")

    var first = this.data.messages[message.room][0]
    if (first.time > message.time) {
      // Optimize adding new oldest message
      this.data.messages[message.room].unshift(message)
      return
    }

    // Fallthrough for insert in the middle of the set.
    console.log("middle insert?")
    for (var i = 0; i < this.data.messages[message.room].length - 1; i++) {
      if (
        this.data.messages[message.room][i].time >= message.time &&
        this.data.messages[message.room][i + 1].time <= message.time
      ) {
        this.data.messages[message.room].splice(i, 0, message)
        inserted = true
        break
      }
    }

    if (!inserted) {
      this.data.messages[message.room].unshift(message)
    }
  },

  // Mutate the data store to switch the active room
  switchRoom: function (roomId) {
    this.data.state.activeRoom = roomId

    this.data.activeRoom = this.data.rooms.find(function (room) {
      return room.id === roomId
    })

    this.data.activeRoom.status = "none" // Clear unread indicator

    this.data.activeMessages = this.data.messages[roomId]
  },

  // Helper function that runs on a schedule and expires any users that
  // have not emitted a join/left event recently.
  _expireEventsInterval: null,
  _expireEvents: function () {
    var now = Date.now()

    for (var i = 0; i < this.data.events.length; i++) {
      if (this.data.events[i].until < now) {
        this.data.events.splice(i, 1)
      }
    }

    if (this.data.events.length === 0) {
      // No users left so stop checking for then.
      clearInterval(this._expireEventsInterval)
      this._expireEventsInterval = null
    }
  },

  addEvent: function (event) {
    event.until = Date.now() + 3000 // add an expiration
    this.data.events.push(event)

    if (!this._expireEventsInterval) {
      // Now that we have events, start checking every 500ms to see if we need to expire one or more.
      this._expireEventsInterval = setInterval(
        this._expireEvents.bind(this),
        500
      )
    }
  },
}

Vue.component("rooms", {
  template: `<div class='rooms'><ul>
    <li class="room" v-on:click="switchRoom(room.id)" :class="{ active: room.id==state.activeRoom }" v-for='room in rooms'>
      <div class="wrap">
        <span class="room-status" v-if="room.status!='none'" :class="room.status"></span>
        <img :src="room.image" alt="" />
        <div class="meta">
          <p class="name">{{ room.name }}</p>
          <p class="preview">{{ room.preview }}</p>
        </div>
      </div>
    </li>
  </ul></div>`,
  data: function () {
    return store.data
  },
  methods: {
    switchRoom: function (roomId) {
      store.switchRoom(roomId)
    },
  },
  updated: function () {
    console.log("updated rooms")
  },
})

Vue.component("room-details", {
  template: `<div class="room-details">
    <img :src="activeRoom.image" alt="" class='description' />
    <p>{{ activeRoom.name }}</p>
    <div class='online-count dropdown'>
      {{ state.presentCount }} online
      <transition name='fade' appear>
        <ul class="dropdown-menu" v-if="events.length > 0" style='display: block;'>
          <template v-for='(event, index) in events'>
            <li class="item" :key="event.until + event.username + event.type"><img :src='event.avatar'>{{ event.username }} {{ event.type}}</li>
          </template>
        </ul>
      </transition>
    </div>
  </div>`,
  data: function () {
    return store.data
  },
  updated: function () {
    console.log("updated room details")
  },
})

Vue.component("messages", {
  template: `
    <div class='messages-wrapper'>
      {{ activeMessages }}
      
      <virtual-list
        class="list"
        :size="50"
        :remain="8"
        :totop='loadMore'
        :onscroll='scroll'
      >
        <div
          v-for="(message, index) of activeMessages"
          :class="{ message: true, replies: message.username!=state.username, sent: message.username==state.username}"
          :index="message.msid"
          :key="message.msid"
        >
          <span class='sender'>{{ message.username }}</span>
          <img :src="message.avatar" />
          <p>{{ message.content.text }}</p>
        </div>
      </virtual-list>
    </div>
  `,
  data: function () {
    return {
      scrolled: false,
      loading: false,
      state: store.data.state,
      messages: store.data.messages,
    }
  },
  computed: {
    activeMessages: function () {
      return this.messages[this.state.activeRoom]
    },
  },
  watch: {
    "state.activeRoom": function () {
      this.loadMore()
      this.scrolled = false
    },
  },
  methods: {
    loadMore: function () {
      if (this.loading) {
        return true
      }

      console.log("loading older messages")

      var self = this

      this.loading = true

      if (!this.state.activeRoom) {
        return
      }

      var from = { room: this.state.activeRoom }

      if (this.messages[this.state.activeRoom].length) {
        from.msid = this.messages[this.state.activeRoom][0].msid
      }

      var messageList = this.$el.querySelector(".list")
      this.oldHeight = messageList.scrollHeight

      socket.emit("message list", from, function (err, response) {
        for (var message of response.messages) {
          store.insertMessage(message)
        }

        self.loading = false
      })
    },

    scroll: function () {
      var messageList = this.$el.querySelector(".list")

      if (
        messageList.scrollTop + messageList.clientHeight ===
        messageList.scrollHeight
      ) {
        this.scrolled = false
      } else {
        this.scrolled = true
      }
    },
  },

  updated: function () {
    var messageList = this.$el.querySelector(".list")

    if (!this.scrolled) {
      // If the user hasn't manually scrolled up then automatically scroll to bottom
      messageList.scrollTop = messageList.scrollHeight
    } else {
      // When we load more content in while scrolled up leave the scroll position in the same
      // place so that the content doesn't move.
      messageList.scrollTop = messageList.scrollHeight - this.oldHeight
    }
  },

  mounted: function () {
    this.loadMore()
    this.scrolled = false
  },
})

Vue.component("message-input", {
  template: `<div class="message-input">
    <div class="wrap">
    <input
      id='textbox'
      type="text"
      placeholder="채팅입력창..."
      @input="writing"
      :value="message"
      @keydown.enter.prevent="submit"
    />
    <button
      class="submit"
      @click="submit">
      <i class="fa fa-paper-plane" aria-hidden="true"></i>
    </button>
    </div>
  </div>`,
  data: function () {
    return { ...store.data, message: null }
  },
  methods: {
    writing(e) {
      this.message = e.target.value
    },

    submit: function () {
      var self = this

      if (this.message.trim() === "") {
        return
      }

      console.log(this.message)

      socket.emit(
        "new message",
        {
          room: this.state.activeRoom,
          message: this.message,
        },
        function (err, message) {
          if (err) {
            return console.error(err)
          }

          store.insertMessage(message)

          console.log(message)
        }
      )

      this.message = ""
    },
  },
})

Vue.component("login", {
  template: `<div class='message-input-form'>
    <div class="wrap">
      <form name="form" v-on:submit.prevent="submit">
        <div class="input-group">
          <span class="input-group-addon"><i class="glyphicon glyphicon-user"></i></span>
          <input type="text" class="username form-control" name="username" value="" placeholder="Username" required>
        </div>
        <div class="form-group">
          <button class="btn btn-primary pull-right"><i class="glyphicon glyphicon-log-in"></i> Submit</button>
        </div>
      </form>
    </div>
  </div>`,
  methods: {
    submit: function () {
      var $username = this.$el.querySelector(".username")
      var username = $username.value.trim()
      var avatar =
        "https://www.gravatar.com/avatar/" +
        CryptoJS.SHA256(username).toString() +
        "?d=retro"

      socket.emit("init user", { username, avatar }, function (err, response) {
        if (err) {
          return console.error(err)
        }

        store.data.state.username = response.username
        store.data.state.avatar = response.avatar

        store.data.state.authenticated = true
        store.data.state.belowMessagesView = "message-input"

        console.log("logged in")
      })
    },
  },
})

new Vue({
  el: "#frame",
  data: store.data,
})

socket.emit("room list", function (err, rooms) {
  store.data.rooms = store.data.rooms.concat(rooms)
  store.switchRoom(store.data.rooms[0].id)
})

// Listen for new messages from the server, and add them to the local store.
socket.on("new message", function (message) {
  // console.log("new message")
  store.liveMessage(message)
})

socket.on("user joined", function (joined) {
  store.data.state.presentCount = joined.numUsers

  store.addEvent({
    type: "joined",
    username: joined.username,
    avatar: joined.avatar,
  })
})

socket.on("user left", function (left) {
  store.data.state.presentCount = left.numUsers

  store.addEvent({
    type: "left",
    username: left.username,
    avatar: left.avatar,
  })
})

socket.on("presence", function (presence) {
  store.data.state.presentCount = presence.numUsers
})

// // Capture the enter key if not already captured by the textbox.
// document.onkeydown = function (evt) {
//   evt = evt || window.event
//   if (evt.keyCode === 13) {
//     document.getElementById("textbox").focus()
//   }
// }
