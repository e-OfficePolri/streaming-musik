package main

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"streaming-musik/media-service/internal/auth"
	"streaming-musik/media-service/internal/subscription"
)

func main() {
	router := gin.Default()

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	authMiddleware := auth.NewMiddleware()
	subscriptionChecker := subscription.NewChecker()

	// Endpoint streaming WAJIB login DAN punya subscription aktif — dua
	// middleware ini dipasang berurutan: auth dulu (supaya kita tahu siapa
	// usernya), baru cek subscription (yang butuh userId dari middleware
	// sebelumnya).
	router.GET(
		"/tracks/:id/stream-url",
		authMiddleware.RequireAuth(),
		subscriptionChecker.RequireActiveSubscription(),
		func(c *gin.Context) {
			trackID := c.Param("id")
			c.JSON(http.StatusOK, gin.H{
				"trackId":   trackID,
				"streamUrl": "https://cdn.example.com/tracks/" + trackID + "/master.m3u8?signature=TODO",
				"expiresIn": 3600,
			})
		},
	)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	router.Run(":" + port)
}

