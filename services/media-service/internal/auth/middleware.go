package auth

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

// Claims harus cocok persis dengan payload yang di-sign auth-service
// (lihat apps/auth-service/src/auth/auth.service.ts) — field "sub", "email",
// "jti".
type Claims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Jti   string `json:"jti"`
	jwt.RegisteredClaims
}

type Middleware struct {
	redisClient *redis.Client
	jwtSecret   []byte
}

func NewMiddleware() *Middleware {
	redisPort, _ := strconv.Atoi(getEnv("REDIS_PORT", "6379"))
	client := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%d", getEnv("REDIS_HOST", "localhost"), redisPort),
	})

	return &Middleware{
		redisClient: client,
		jwtSecret:   []byte(getEnv("JWT_SECRET", "ganti-di-produksi")),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// RequireAuth adalah Gin middleware: verifikasi signature JWT (harus sama
// persis JWT_SECRET dengan auth-service — token ini diterbitkan di sana),
// lalu cek blocklist di Redis untuk device yang sudah di-logout paksa.
// User ID dan jti hasil verifikasi disimpan di context request untuk dipakai
// handler/middleware berikutnya (lihat subscription.RequireActiveSubscription).
func (m *Middleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "Token tidak ditemukan"})
			return
		}
		rawToken := strings.TrimPrefix(authHeader, "Bearer ")

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(rawToken, claims, func(t *jwt.Token) (interface{}, error) {
			return m.jwtSecret, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "Token tidak valid atau kedaluwarsa"})
			return
		}

		revoked, err := m.redisClient.Get(context.Background(), "revoked-jti:"+claims.Jti).Result()
		if err == nil && revoked != "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "Sesi ini sudah dicabut, silakan login ulang"})
			return
		}

		c.Set("userId", claims.Sub)
		c.Set("rawToken", rawToken) // diteruskan ke payment-service saat cek subscription
		c.Next()
	}
}
