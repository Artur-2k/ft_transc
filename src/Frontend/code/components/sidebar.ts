import { getUserDataById, UserData } from "../api/getUserDataAPI";
import { getUserAvatarById } from "../api/getUserAvatarAPI";
import { getSelfConversations, Conversation } from "../api/getSelfConversationsAPI";
import { getFriendRequests, FriendRequest } from "../api/getFriendRequestsAPI";
import { acceptFriendRequest } from "../api/acceptFriendRequestAPI";
import { rejectFriendRequest } from "../api/rejectFriendRequestAPI"
import { createFriendRequestByUsername } from "../api/createFriendRequestAPI"
import { authService } from "../services/authService";
import { webSocketService, MessageDTO } from "../services/webSocketService";
import { chatWindowControler } from "./chatWindow";

export interface Friend {
  convID: number;
  friendID: number;
  friendName: string;
  friendAvatar: string;
  unreadMsg: number;
  friendOn: boolean;
}

export interface ContactElement {
  element: HTMLButtonElement;
  handler: () => void;
}


export class Chat {
  private sidebar: HTMLElement;

  private friends: Array<Friend>;
  private friendRequests: Map<string, FriendRequest> | null; // Map
  private friendRequestCount: number;

  /* (convID, {element: contactBtn, handler: clickHandler }) */
  private contactElements: Map<number, ContactElement>;

  constructor() {
    this.sidebar = document.querySelector("aside") as HTMLElement;
    this.friends = [];

    this.friendRequests = null;
    this.friendRequestCount = 0;

    this.contactElements = new Map();
  }

  async init(): Promise<void> {
    this.sidebar.innerHTML = this.renderHTML();
    await this.attachHeaderEventListeners();

    try {
      const reqArray: FriendRequest[] = await getFriendRequests();
      this.friendRequestCount = reqArray.length;
      this.friendRequests = new Map(
        reqArray.map((req) => [req.sender_username, req])
      );
    } catch (error) {
      console.error("Error at Chat initialization", error);
      // could check why and handle it individually
      authService.logout();
      return;
    }

    this.updateFriendRequestsNumber(this.friendRequestCount);

    await this.getSidebarConversations();

    webSocketService.connect(authService.userID);

    webSocketService.registerNotificationCallback((convID) => {
      this.handleNotification(convID);
    });

    webSocketService.registerOnlineCallbacks((online_users) => {
      this.handleRecieveOnlineUsers(online_users);
    });

    webSocketService.registerFriendsUpdateCallbacks((data) => {
      this.handleUpdateFriends(data);
    });

    /*
      metadata: {user_id?: string = reciever_id?,
                event: "new_friend_request"}
  */
    webSocketService.registerFriendRequestsUpdate(() => {
      this.updateFriendRequestsNumber(this.friendRequestCount + 1);
      //! this.friendRequests?.set()  TODO check this event!!!
    });

    this.insertContactsOnSidebar();
  }

  renderHTML(): string {
    return `
      <div id="chat-sidebar" class="chat-sidebar content w-[200px] flex-shrink-0">
        <!-- Topbar with friend + search -->

        <div class="chat-sidebar-topbar">
          <button class="icon-btn add-friend">
            <img src="./Assets/icons/person-add.svg" alt="Add Friend" />
          </button>
          
          <input type="text" class="search-input" placeholder="Search..." spellcheck="false" />
        </div>

        <div class="friend-requests-btn-wrapper">
          <button class="friend-requests-btn icon-btn" id="friend-requests-btn">
            <span class="friend-requests-text">Friend Requests</span>
            <span class="friend-requests-count">${this.friendRequestCount}</span>
          </button>
        </div>

        <div class="chat-contacts-wrapper">
          <div class="chat-contacts"></div>
        </div>  

      </div>

      <div id="add-friend-popover" class="add-friend-popover hidden">
        <input type="text" id="friend-username-input" placeholder="Username..." />
        <button id="send-friend-request-btn">Add</button>
      </div>  

        `;
  }

  renderFriendRequestsHTML(): string {
    return `
      <dialog class="friend-requests-wrapper" id="friendRequestsDialog" >
        <button class="close-dialog-btn">&times;</button> <!-- onclick="closeDialog()" -->

        <h1 class="title friend-request-header">Friend Requests</h1>

        <div class="requests-container"></div>
      </dialog>
    `;
  }

  async addFriendEventListener(): Promise<void> {
    const addFriendBtn = document.querySelector('.add-friend') as HTMLButtonElement;
    const popover = document.getElementById('add-friend-popover') as HTMLDivElement;
    const popoverInput = document.getElementById('friend-username-input') as HTMLInputElement;
    const popoverSendBtn = document.getElementById('send-friend-request-btn') as HTMLButtonElement;

    addFriendBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      popover.classList.toggle('hidden');
      if (popover.classList.contains('hidden'))
        popoverInput.value = "";
      else
        popoverInput.focus();
    });

    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!popover.contains(target) && !addFriendBtn.contains(target)) {
        popover.classList.add('hidden');
        popoverInput.value = "";
      }
    });

    popoverSendBtn.addEventListener('click', async () => {
      const username: string = popoverInput.value.trim();
      if (username) {
        try {
          await createFriendRequestByUsername(username);
        } catch (error) {
          //TODO
          console.error(`DEBUG: Could not create friend request\n`, error);
        }
        popoverInput.value = '';
        popover.classList.add('hidden');
      }
    });
  }

  searchFriendEventListener(): void {
    const searchInput = document.querySelector(".search-input");
    if (searchInput instanceof HTMLInputElement) {
      searchInput.addEventListener('input', (e: Event) => {
        e.preventDefault();

        this.contactElements.forEach(({ element }) => {
          let value = searchInput.value;
          if (value === "") { // reset
            element.style.display = "flex";
            return;
          }
          const username = element.classList[1].slice(2).toLowerCase(); // skip the f- from class name

          element.style.display = username.includes(value) ? "flex" : "none";
        })
      });
    }
  }

  async friendRequestEventListener(): Promise<void> {
    const friendRequestBtn = document.getElementById("friend-requests-btn") as HTMLButtonElement;
    if (friendRequestBtn) {
      friendRequestBtn.addEventListener("click", async (e: MouseEvent) => {
        e.preventDefault();
        await this.openFriendRequetsDialog();
      });
    }
  }

  async attachHeaderEventListeners(): Promise<void> {
    // ADD FRIENDS
    await this.addFriendEventListener();

    // SEARCH
    this.searchFriendEventListener();

    // FRIEND REQUESTS
    await this.friendRequestEventListener();
  }

  // this ensures there is no memory leaks and is considered better than just empty out the html
  // eventlisteners might cause some leaks if cleared that way
  deleteSideBar(): void {
    this.sidebar.replaceWith(this.sidebar.cloneNode(false));
    this.sidebar.remove();
  }

  async getSidebarConversations(): Promise<void> {
    let convs: Conversation[];
    try {
      convs = await getSelfConversations();
      if (convs.length == 0) return;
    } catch (error) {
      console.error("Error getting conversations", error);
      authService.logout();
      // could be improved
      return;
    }

    for (const conv of convs) {
      const friendID =
        conv.user1_id === authService.userID ? conv.user2_id : conv.user1_id;
      try {
        const friendData = await getUserDataById(friendID);
        const friendAvatarURL = await getUserAvatarById(friendID);
  
        this.friends.push({
          convID: conv.id,
          friendID: friendID,
          friendName: friendData.name,
          friendAvatar: friendAvatarURL,
          unreadMsg: conv.unread_count,
          friendOn: false,
        });  

        // conversationTracker initialization
        webSocketService.conversationTracker.set(conv.id, conv.unread_count);
      } catch (error) {
        console.error("Error getting friend on sidebar", error);
        // just skip it. could be improved
      }

    }
  }

  createContactElement(friendAvatar: string, friendName: string, unreadMsg: number): HTMLButtonElement {
    const newContact = document.createElement("button") as HTMLButtonElement;
    newContact.className = `contact f-${friendName}`;
    newContact.innerHTML = `
                  <img src="${friendAvatar}" width="40px" height="40px">
                  <span>${friendName}</span>
                  <span class="unread-badge" style="display: ${unreadMsg ? "inline" : "none"};">${unreadMsg}</span>
                  `;
    return newContact;
  }

  updateFriendRequestsNumber(number: number): void {
    const count = this.sidebar.querySelector(".friend-requests-count");
    if (!(count instanceof HTMLSpanElement)) return;
    count.textContent = `${number}`;
  }

  async createFriendRequestElement(friendRequest: FriendRequest): Promise<HTMLDivElement> {
    const newRequest = document.createElement("div") as HTMLDivElement;
    newRequest.classList = `request-wrapper ${friendRequest.sender_username}`;
    const requestAvatar = await getUserAvatarById(friendRequest.sender_id);
    newRequest.innerHTML = `
        <div class="user-info">
          <img src="${requestAvatar}" alt="user-avatar" />

          <span>${friendRequest.sender_name}</span>
        </div>

        <div class="request-options">
          <button class="request-btn accept" id="friend-accept" data-username="${friendRequest.sender_username}" title="Accept">
            <img src="../../Assets/icons/check-circle.svg" />
          </button>

          <button class="request-btn reject" id="friend-reject" data-username="${friendRequest.sender_username}" title="Reject">
            <img src="../../Assets/icons/cancel-circle.svg" />
          </button>
        </div>
    `;
    return newRequest;
  }

  async insertFriendRequests(): Promise<void> {
    const requestsContainer = document.querySelector(".requests-container");
    if (!(requestsContainer instanceof HTMLDivElement)) return;

    requestsContainer.textContent = this.friendRequestCount ?
      "" : "No friend requests";

    if (!this.friendRequests) return;
    for (const request of this.friendRequests.values()) {
      const element = await this.createFriendRequestElement(request);
      requestsContainer.appendChild(element);
    }
  }

  deleteFriendRequest(username: string): void {
    const friendRequestElement = document.querySelector(`.request-wrapper.${username}`);
    if (!(friendRequestElement instanceof HTMLDivElement)) return;

    friendRequestElement.remove();
    this.friendRequestCount--;
    this.friendRequests?.delete(username);

    if (this.friendRequestCount == 0) {
      const reqContainer = document.querySelector('.requests-container');
      if (reqContainer instanceof HTMLDivElement) {
        reqContainer.textContent = "No friend requests";
      }
    }
    this.updateFriendRequestsNumber(this.friendRequestCount);
  }

  async openFriendRequetsDialog(): Promise<void> {
    if (document.getElementById("friendRequestsDialog")) return; // prevent doubling

    const dialogHTML = this.renderFriendRequestsHTML();
    document.body.insertAdjacentHTML("beforeend", dialogHTML);

    await this.insertFriendRequests();

    const dialog = document.getElementById("friendRequestsDialog");
    if (dialog instanceof HTMLDialogElement) {
      this.attachFriendRequetsDialogEventListeners(dialog);
      dialog.showModal();
    }
  }

  attachFriendRequetsDialogEventListeners(dialog: HTMLDialogElement): void {
    const closeBtn = dialog.querySelector(".close-dialog-btn");
    // Close dialog handler
    const closeHandler = () => {
      dialog.close();
      dialog.remove(); // Clean up from DOM
    };

    if (closeBtn instanceof HTMLButtonElement) {
      closeBtn.addEventListener("click", closeHandler);
    }

    // Close on backdrop click
    dialog.addEventListener("click", (e: MouseEvent) => {
      if (e.target === dialog) {
        // if i click on something that is a child its not the dialog(backdrop is tho!)
        closeHandler();
      }
    });

    const requestsContainer = document.querySelector(".requests-container");
    if (requestsContainer instanceof HTMLDivElement) {
      requestsContainer.addEventListener("click", async (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const btn = target.closest("button.request-btn");
        if (!(btn instanceof HTMLButtonElement)) return; // click not on the button

        const username = btn.dataset.username;
        if (!username) return;

        if (!this.friendRequests) return;

        try {
          if (btn.classList.contains("accept")) {
            await acceptFriendRequest(
              this.friendRequests.get(username)?.request_id!
            );
          } else if (btn.classList.contains("reject")) {
            await rejectFriendRequest(
              this.friendRequests.get(username)?.request_id!
            );
          }
  
          this.deleteFriendRequest(username);
        } catch (error) {
          console.error("Error: could not handle friend request action", error);
          // could implement better error handling
          authService.logout();
          return;
        }
      });
    }
  }

  deleteContact(convID: number): void {
    const entry = this.contactElements.get(convID);
    if (!entry) return;

    entry.element.removeEventListener("click", entry.handler);
    entry.element.remove();
    this.contactElements.delete(convID); // remove from element map
    this.friends.filter((f) => f.convID !== convID); // remove from friend array
  }

  insertContactsOnSidebar(): void {
    const chatContacts = document.querySelector(".chat-contacts");
    if (chatContacts instanceof HTMLDivElement) {
      this.friends.forEach((friend) => {
        const contactBtn = this.createContactElement(
          friend.friendAvatar,
          friend.friendName,
          friend.unreadMsg
        );
  
        const clickHandler = () => {
          chatWindowControler.open(friend);
          this.updateContactUnreadUI(friend.convID, 0);
        };
  
        contactBtn.addEventListener("click", clickHandler);
  
        chatContacts.appendChild(contactBtn);
  
        this.contactElements.set(friend.convID, {
          element: contactBtn,
          handler: clickHandler,
        });
      });
    }
  }

  async handleUpdateFriends(data: MessageDTO): Promise<void> {
    if (data.metadata === "newConversation") {
      const friendID: number = Number(data.message);
      try {
        const friendData: UserData = await getUserDataById(friendID);
        let friendAvatarURL: string = await getUserAvatarById(friendID);
        
        this.friends.push({
          convID: data.conversation_id,
          friendID: friendID,
          friendName: friendData.name,
          friendAvatar: friendAvatarURL,
          unreadMsg: 0,
          friendOn: false,
        } as Friend);
  
        const friend = this.friends[this.friends.length - 1];
        const contactBtn = this.createContactElement(
          friend.friendAvatar,
          friend.friendName,
          friend.unreadMsg
        );
  
        const clickHandler = () => {
          chatWindowControler.open(friend);
          this.updateContactUnreadUI(friend.convID, 0);
        };
  
        contactBtn.addEventListener("click", clickHandler);
  
        const chatContacts = document.querySelector(".chat-contacts");
        chatContacts?.appendChild(contactBtn);
  
        this.contactElements.set(friend.convID, {
          element: contactBtn,
          handler: clickHandler,
        });
        // else if (type === "remove") { } // todo remover amizade
      } catch (error) {
        console.error("Error getting new conversation with new friend", error);
        //could implement better error handling
        authService.logout();
        return;
      }
    }
  }

  updateContactUnreadUI(convID: number, unreadCount: number): void {
    if (!this.contactElements) return;
    const contactElement = this.contactElements.get(convID)?.element;
    if (contactElement) {
      const badge = contactElement.querySelector(".unread-badge");
      if (badge instanceof HTMLSpanElement) {
        if (unreadCount > 0) {
          badge.textContent = `${unreadCount}`;
          badge.style.display = "inline";
          contactElement.classList.add("has-unread");
        } else {
          badge.style.display = "none";
          contactElement.classList.remove("has-unread");
        }
      }
    }
  }

  handleNotification(convID: number): void {
    const unreadCount = webSocketService.getUnreadCount(convID);
    this.updateContactUnreadUI(convID, unreadCount);
  }

  /* {online_users: [2, 4, 6]} */
  handleRecieveOnlineUsers(onlineFriends: Array<number>) {
    this.friends.forEach((f) => {
      f.friendOn = onlineFriends.includes(f.friendID) ? true : false;

      const query = this.contactElements.get(f.convID);
      if (!query) return;
      const img = query.element.querySelector("img");
      if (!img) return;

      if (f.friendOn) {
        img.style.border = "2.3px solid #31be06";
        img.style.boxShadow = "0px 0px 4px #31be06";
      } else {
        img.style.border = "2.3px solid #676768";
        img.style.boxShadow = "0px 0px 4px #676768";
      }
    });
  }
}
