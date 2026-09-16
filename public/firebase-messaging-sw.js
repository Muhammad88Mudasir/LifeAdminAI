// Life Admin AI - Firebase Cloud Messaging Service Worker

importScripts(
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyCA09yChwyrD_JsqdzPrT1SClPRYBIaOh8",
  authDomain: "lifeadminai-2b796.firebaseapp.com",
  projectId: "lifeadminai-2b796",
  storageBucket: "lifeadminai-2b796.firebasestorage.app",
  messagingSenderId: "874467303774",
  appId: "1:874467303774:web:16c3dab2bf4906caa32fcf"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log(
    "Life Admin AI background notification:",
    payload
  );

  const title =
    payload.notification &&
    payload.notification.title
      ? payload.notification.title
      : "Life Admin AI";

  const body =
    payload.notification &&
    payload.notification.body
      ? payload.notification.body
      : "You have a task due.";

  self.registration.showNotification(title, {
    body: body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: payload.data || {},
    requireInteraction: true
  });
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(function(clientList) {

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