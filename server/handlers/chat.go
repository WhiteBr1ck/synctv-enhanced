package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/synctv-org/synctv/internal/db"
	"github.com/synctv-org/synctv/server/middlewares"
	"github.com/synctv-org/synctv/server/model"
)

func ChatHistory(ctx *gin.Context) {
	room := middlewares.GetRoomEntry(ctx).Value()
	messages, err := db.GetChatHistory(room.ID)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusInternalServerError, model.NewAPIErrorResp(err))
		return
	}
	ctx.JSON(http.StatusOK, model.NewAPIDataResp(messages))
}
