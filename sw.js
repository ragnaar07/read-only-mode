var CACHE_NAME = "timelog-v2";
var ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ASSETS);
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  event.respondWith(
    caches.match(event.request).then(function(cached){
      return cached || fetch(event.request).then(function(res){
        return caches.open(CACHE_NAME).then(function(cache){
          if(event.request.method === "GET" && res.status === 200){
            cache.put(event.request, res.clone());
          }
          return res;
        });
      }).catch(function(){
        if(event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  var targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "./index.html";
  event.waitUntil(
    self.clients.matchAll({type:"window", includeUncontrolled:true}).then(function(clientList){
      for(var i=0;i<clientList.length;i++){
        var client = clientList[i];
        if("focus" in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
