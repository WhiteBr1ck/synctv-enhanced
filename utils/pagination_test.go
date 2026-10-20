package utils_test

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/synctv-org/synctv/utils"
)

func TestDirectoryBatchLimitDoesNotChangeOtherAPIs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("GET", "/?page=2&max=10000", nil)
	page, size, err := utils.GetPageAndMax(ctx)
	if err != nil || page != 2 || size != 100 {
		t.Fatalf("ordinary limit changed: %d %d %v", page, size, err)
	}
	page, size, err = utils.GetPageAndMaxWithLimit(ctx, 10000)
	if err != nil || page != 2 || size != 10000 {
		t.Fatalf("directory snapshot capped: %d %d %v", page, size, err)
	}
	ctx.Request = httptest.NewRequest("GET", "/?max=10001", nil)
	_, size, err = utils.GetPageAndMaxWithLimit(ctx, 10000)
	if err != nil || size != 10000 {
		t.Fatal("unbounded directory batch")
	}
}
