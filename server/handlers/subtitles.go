package handlers

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	dbModel "github.com/synctv-org/synctv/internal/model"
	"github.com/synctv-org/synctv/server/handlers/vendors/vendoralist"
	"github.com/synctv-org/synctv/server/middlewares"
	"github.com/synctv-org/synctv/server/model"
	"github.com/synctv-org/synctv/utils"
)

// This endpoint shares current-movie authentication and only resolves sibling
// subtitle basenames. The client never supplies a server URL or directory.
func FolderSubtitles(ctx *gin.Context) {
	room := middlewares.GetRoomEntry(ctx).Value()
	current := room.Current().Movie
	if current.ID == "" || ctx.Query("movieId") != current.ID || ctx.Query("subPath") != current.SubPath {
		ctx.AbortWithStatusJSON(http.StatusConflict, model.NewAPIErrorStringResp("影片已切换，请重新打开字幕菜单"))
		return
	}
	movie, err := room.GetMovieByID(current.ID)
	if err != nil || movie.VendorInfo.Vendor != dbModel.VendorAlist {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp("当前来源不支持读取字幕目录"))
		return
	}
	service, err := vendoralist.NewAlistVendorService(room, movie)
	if err != nil {
		ctx.AbortWithStatus(http.StatusBadRequest)
		return
	}
	request, cancel := context.WithTimeout(ctx.Request.Context(), 30*time.Second)
	defer cancel()
	ctx.Header("Cache-Control", "no-store")
	ctx.Header("X-Content-Type-Options", "nosniff")
	if name := ctx.Query("file"); name != "" {
		if !utils.ValidSubtitleFile(name) {
			ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp("无效的字幕文件名"))
			return
		}
		data, err := service.ReadFolderSubtitle(request, current.SubPath, name)
		if err != nil {
			ctx.AbortWithStatusJSON(http.StatusBadGateway, model.NewAPIErrorStringResp("字幕文件读取失败，请检查文件和访问权限"))
			return
		}
		ctx.Data(http.StatusOK, "text/plain; charset=utf-8", data)
		return
	}
	tracks, err := service.FolderSubtitles(request, current.SubPath, ctx.Query("refresh") == "1")
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadGateway, model.NewAPIErrorStringResp("读取字幕目录失败，请检查 AList 权限后重试"))
		return
	}
	for i := range tracks {
		query := url.Values{"movieId": {current.ID}, "subPath": {current.SubPath}, "file": {tracks[i].Name}}
		tracks[i].URL = "/api/room/movie/folder-subtitles?" + query.Encode()
	}
	ctx.JSON(http.StatusOK, model.NewAPIDataResp(gin.H{"tracks": tracks}))
}
