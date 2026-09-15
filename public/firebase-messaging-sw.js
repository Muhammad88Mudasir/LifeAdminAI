```javascript
// Life Admin AI - Firebase Cloud Messaging Service Worker

importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js"
);

const firebaseConfig = {
  apiKey: "AIzaSyCA09yChwyrD_JsqdzPrT1SClPRYBIaOh8",
  authDomain: "lifeadminai-2b796.firebaseapp.com",
  projectId: "lifeadminai-2b796",
  storageBucket: "lifeadminai-2b796.firebasestorage.app",
  messagingSenderId: "874467303774",
  appId: "1:874467303774:web:16c3dab2bf4906caa32fcf"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {

  console.log(
    "Life Admin AI background notification:",
    payload
  );

  const notificationTitle =
    payload.notification?.title ||
    "Life Admin AI";

  const notificationOptions = {
    body:
      payload.notification?.body ||
      "You have a task due.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: payload.data || {},
    requireInteraction: true
  };

  self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});

self.addEventListener("notificationclick", (event) => {

  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {

      for (const client of clientList) {

        if ("focus" in client) {
          return client.focus();
        }

      }

      if (clients.openWindow) {
        return clients.openWindow("/");
      }

    })
  );

});
```
