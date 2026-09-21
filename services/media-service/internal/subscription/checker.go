package subscription

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// Status subscription JARANG berubah dibanding volume request streaming
// yang tinggi — jadi kita cache hasilnya di Redis, bukan panggil
// payment-service di SETIAP request stream. Trade-off yang disengaja: kalau
// user baru saja bayar, butuh waktu sampai CACHE_TTL sebelum akses premium-nya
// aktif di media-service. 2 menit dianggap cukup singkat untuk UX, tapi
// cukup panjang untuk memangkas beban ke payment-service secara signifikan.
const cacheTTL = 2 * time.Minute

type statusResponse struct {
	Status           string     `json:"status"`
	CurrentPeriodEnd *time.Time `json:"currentPeriodEnd"`
}

type Checker struct {
	redisClient    *redis.Client
	paymentBaseURL string
	httpClient     *http.Client
}

func NewChecker() *Checker {
	redisPort, _ := strconv.Atoi(getEnv("REDIS_PORT", "6379"))
	client := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%d", getEnv("REDIS_HOST", "localhost"), redisPort),
	})

	return &Checker{
		redisClient:    client,
		paymentBaseURL: getEnv("PAYMENT_SERVICE_URL", "http://localhost:3003"),
		httpClient:     &http.Client{Timeout: 5 * time.Second},
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func (c *Checker) isActive(userId, rawToken string) (bool, error) {
	cacheKey := "subscription-status:" + userId

	cached, err := c.redisClient.Get(context.Background(), cacheKey).Result()
	if err == nil {
		var status statusResponse
		if jsonErr := json.Unmarshal([]byte(cached), &status); jsonErr == nil {
			return status.Status == "active", nil
		}
	}

	// Cache miss (atau corrupt) — tanya langsung ke payment-service.
	// Bearer token user diteruskan APA ADANYA (bukan token internal
	// service-to-service terpisah) — ini valid karena payment-service
	// memverifikasi token yang sama persis, diterbitkan oleh auth-service
	// yang sama. Kalau butuh isolasi lebih ketat nanti, ganti dengan token
	// service-to-service (misal mTLS internal atau API key khusus).
	req, err := http.NewRequest("GET", c.paymentBaseURL+"/subscriptions/me", nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+rawToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("payment-service merespons status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}

	var status statusResponse
	if err := json.Unmarshal(body, &status); err != nil {
		return false, err
	}

	// Simpan ke cache TERLEPAS dari hasilnya aktif atau tidak — supaya user
	// yang belum berlangganan juga tidak membanjiri payment-service dengan
	// request berulang tiap kali mereka coba stream.
	c.redisClient.Set(context.Background(), cacheKey, body, cacheTTL)

	return status.Status == "active", nil
}

// RequireActiveSubscription adalah Gin middleware — pasang SETELAH
// auth.RequireAuth() di route chain, karena butuh "userId" dan "rawToken"
// yang di-set middleware itu.
func (c *Checker) RequireActiveSubscription() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		userId := ctx.GetString("userId")
		rawToken := ctx.GetString("rawToken")

		active, err := c.isActive(userId, rawToken)
		if err != nil {
			// Gagal cek subscription (misal payment-service down) TIDAK
			// otomatis meloloskan akses — fail closed, bukan fail open,
			// supaya orang tidak bisa streaming gratis cuma karena
			// payment-service sedang bermasalah.
			ctx.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"message": "Tidak bisa memverifikasi status langganan saat ini, coba lagi sebentar.",
			})
			return
		}

		if !active {
			ctx.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"message": "Langganan kamu sudah berakhir. Perpanjang dulu untuk lanjut streaming.",
			})
			return
		}

		ctx.Next()
	}
}
