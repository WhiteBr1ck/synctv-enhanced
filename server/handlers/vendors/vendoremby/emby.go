package vendoremby

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/synctv-org/synctv/internal/db"
	dbModel "github.com/synctv-org/synctv/internal/model"
	"github.com/synctv-org/synctv/internal/op"
	"github.com/synctv-org/synctv/internal/vendor"
	"github.com/synctv-org/synctv/server/handlers/proxy"
	"github.com/synctv-org/synctv/server/middlewares"
	"github.com/synctv-org/synctv/server/model"
	"github.com/synctv-org/synctv/utils"
	"github.com/synctv-org/vendors/api/emby"
)

type EmbyVendorService struct {
	room  *op.Room
	movie *op.Movie
}

func NewEmbyVendorService(room *op.Room, movie *op.Movie) (*EmbyVendorService, error) {
	if movie.VendorInfo.Vendor != dbModel.VendorEmby {
		return nil, fmt.Errorf("emby vendor not support vendor %s", movie.VendorInfo.Vendor)
	}

	return &EmbyVendorService{
		room:  room,
		movie: movie,
	}, nil
}

func (s *EmbyVendorService) Client() emby.EmbyHTTPServer {
	return vendor.LoadEmbyClient(s.movie.VendorInfo.Backend)
}

//nolint:gosec
func (s *EmbyVendorService) ListDynamicMovie(
	ctx context.Context,
	reqUser *op.User,
	subPath, keyword string,
	page, _max int,
) (*model.MovieList, error) {
	if reqUser.ID != s.movie.CreatorID {
		return nil, fmt.Errorf("list vendor dynamic folder error: %w", dbModel.ErrNoPermission)
	}

	user := reqUser

	resp := &model.MovieList{
		Paths: []*model.MoviePath{},
	}

	serverID, truePath, err := s.movie.VendorInfo.Emby.ServerIDAndFilePath()
	if err != nil {
		return nil, fmt.Errorf("load emby server id error: %w", err)
	}

	configuredRoot := truePath
	if subPath != "" {
		truePath = subPath
	}

	aucd, err := user.EmbyCache().LoadOrStore(ctx, serverID)
	if err != nil {
		if errors.Is(err, db.NotFoundError(db.ErrVendorNotFound)) {
			return nil, errors.New("emby server not found")
		}
		return nil, err
	}

	data, err := s.Client().FsList(ctx, &emby.FsListReq{
		Host:       aucd.Host,
		Path:       truePath,
		Token:      aucd.APIKey,
		UserId:     aucd.UserID,
		Limit:      uint64(_max),
		StartIndex: uint64((page - 1) * _max),
		SearchTerm: keyword,
	})
	if err != nil {
		return nil, fmt.Errorf("emby fs list error: %w", err)
	}

	resp.Total = int64(data.GetTotal())
	paths := data.GetPaths()
	for i, p := range paths {
		if configuredRoot != "" && p.GetPath() == configuredRoot {
			paths = paths[i+1:]
			break
		}
	}
	for _, p := range paths {
		if p.GetPath() != "" {
			resp.Paths = append(resp.Paths, &model.MoviePath{Name: p.GetName(), ID: s.movie.ID, SubPath: p.GetPath()})
		}
	}

	resp.Movies = make([]*model.Movie, len(data.GetItems()))
	for i, flr := range data.GetItems() {
		resp.Movies[i] = &model.Movie{
			ID:        s.movie.ID,
			CreatedAt: s.movie.CreatedAt.UnixMilli(),
			Creator:   op.GetUserName(s.movie.CreatorID),
			CreatorID: s.movie.CreatorID,
			SubPath:   flr.GetId(),
			Base: dbModel.MovieBase{
				Name:     flr.GetName(),
				Type:     flr.GetType(),
				IsFolder: flr.GetIsFolder(),
				ParentID: dbModel.EmptyNullString(s.movie.ID),
				VendorInfo: dbModel.VendorInfo{
					Vendor:  dbModel.VendorEmby,
					Backend: s.movie.VendorInfo.Backend,
					Emby: &dbModel.EmbyStreamingInfo{
						Path: dbModel.FormatEmbyPath(serverID, flr.GetId()),
					},
				},
			},
		}
	}

	return resp, nil
}

func (s *EmbyVendorService) handleProxyMovie(ctx *gin.Context) {
	log := middlewares.GetLogger(ctx)

	if !s.movie.Proxy {
		log.Errorf("proxy vendor movie error: %v", "proxy is not enabled")
		ctx.AbortWithStatusJSON(
			http.StatusBadRequest,
			model.NewAPIErrorStringResp("proxy is not enabled"),
		)

		return
	}

	u, err := op.LoadOrInitUserByID(s.movie.CreatorID)
	if err != nil {
		log.Errorf("proxy vendor movie error: %v", err)
		ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp(err.Error()))
		return
	}

	embyC, err := s.movie.EmbyCache().Get(ctx, u.Value().EmbyCache())
	if err != nil {
		log.Errorf("proxy vendor movie error: %v", err)
		ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp(err.Error()))
		return
	}

	if len(embyC.Sources) == 0 {
		log.Errorf("proxy vendor movie error: %v", "no source")
		ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp("no source"))
		return
	}

	source, err := strconv.Atoi(ctx.Query("source"))
	if err != nil {
		log.Errorf("proxy vendor movie error: %v", err)
		ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp(err.Error()))
		return
	}

	if source >= len(embyC.Sources) {
		log.Errorf("proxy vendor movie error: %v", "source out of range")
		ctx.AbortWithStatusJSON(
			http.StatusBadRequest,
			model.NewAPIErrorStringResp("source out of range"),
		)

		return
	}

	if embyC.Sources[source].IsTranscode {
		ctx.Redirect(http.StatusFound, viewerSourceURL(embyC.Sources[source].URL, embyC.Sources[source].IsCompatibility))
		return
	}

	// ignore DeviceId, PlaySessionId as cache key
	sourceCacheKey, err := url.Parse(embyC.Sources[source].URL)
	if err != nil {
		log.Errorf("proxy vendor movie error: %v", err)
		ctx.AbortWithStatusJSON(http.StatusBadRequest, model.NewAPIErrorStringResp(err.Error()))
		return
	}

	query := sourceCacheKey.Query()
	query.Del("DeviceId")
	query.Del("PlaySessionId")
	sourceCacheKey.RawQuery = query.Encode()

	err = proxy.AutoProxyURL(ctx,
		embyC.Sources[source].URL,
		"",
		nil,
		ctx.GetString("token"),
		s.movie.RoomID,
		s.movie.ID,
		proxy.WithProxyURLCache(true),
		proxy.WithProxyURLCacheKey(sourceCacheKey.String()),
	)
	if err != nil {
		log.Errorf("proxy vendor movie error: %v", err)
	}
}

func (s *EmbyVendorService) handleSubtitle(ctx *gin.Context) error {
	u, err := op.LoadOrInitUserByID(s.movie.CreatorID)
	if err != nil {
		return err
	}

	embyC, err := s.movie.EmbyCache().Get(ctx, u.Value().EmbyCache())
	if err != nil {
		return err
	}

	source, err := strconv.Atoi(ctx.Query("source"))
	if err != nil {
		return err
	}

	if source >= len(embyC.Sources) {
		return errors.New("source out of range")
	}

	id, err := strconv.Atoi(ctx.Query("id"))
	if err != nil {
		return err
	}

	if id >= len(embyC.Sources[source].Subtitles) {
		return errors.New("id out of range")
	}

	data, err := embyC.Sources[source].Subtitles[id].Cache.Get(ctx)
	if err != nil {
		return err
	}

	http.ServeContent(
		ctx.Writer,
		ctx.Request,
		embyC.Sources[source].Subtitles[id].Name,
		time.Now(),
		bytes.NewReader(data),
	)

	return nil
}

func (s *EmbyVendorService) ProxyMovie(ctx *gin.Context) {
	switch t := ctx.Query("t"); t {
	case "":
		s.handleProxyMovie(ctx)
	case "subtitle":
		_ = s.handleSubtitle(ctx)
	default:
		ctx.AbortWithStatusJSON(
			http.StatusBadRequest,
			model.NewAPIErrorStringResp("unknown proxy type: "+t),
		)
	}
}

func (s *EmbyVendorService) GenMovieInfo(
	ctx context.Context,
	user *op.User,
	userAgent, userToken string,
) (*dbModel.Movie, error) {
	if s.movie.Proxy {
		return s.GenProxyMovieInfo(ctx, user, userAgent, userToken)
	}

	movie := s.movie.Clone()

	var err error

	u, err := op.LoadOrInitUserByID(movie.CreatorID)
	if err != nil {
		return nil, err
	}

	data, err := s.movie.EmbyCache().Get(ctx, u.Value().EmbyCache())
	if err != nil {
		return nil, err
	}

	if len(data.Sources) == 0 {
		return nil, errors.New("no source")
	}
	if data.Name != "" {
		movie.Name = data.Name
	}
	movie.VideoRange = data.VideoRange

	movie.URL = viewerSourceURL(data.Sources[0].URL, data.Sources[0].IsCompatibility)
	movie.Type = utils.GetURLExtension(movie.URL)
	movie.PlaybackMode = playbackMode(data.Sources[0].IsTranscode)
	for _, s := range data.Sources[0].Subtitles {
		if movie.Subtitles == nil {
			movie.Subtitles = make(map[string]*dbModel.Subtitle, len(data.Sources[0].Subtitles))
		}

		movie.Subtitles[s.Name] = s.Subtitle()
	}

	for _, s := range data.Sources[1:] {
		movie.MoreSources = append(movie.MoreSources,
			&dbModel.MoreSource{
				Name:         s.Name,
				URL:          viewerSourceURL(s.URL, s.IsCompatibility),
				Type:         utils.GetURLExtension(s.URL),
				PlaybackMode: playbackMode(s.IsTranscode),
			},
		)

		for _, subt := range s.Subtitles {
			if movie.Subtitles == nil {
				movie.Subtitles = make(map[string]*dbModel.Subtitle, len(s.Subtitles))
			}

			movie.Subtitles[subt.Name] = subt.Subtitle()
		}
	}

	return movie, nil
}

func (s *EmbyVendorService) GenProxyMovieInfo(
	ctx context.Context,
	_ *op.User,
	_, userToken string,
) (*dbModel.Movie, error) {
	movie := s.movie.Clone()

	var err error

	u, err := op.LoadOrInitUserByID(movie.CreatorID)
	if err != nil {
		return nil, err
	}

	data, err := s.movie.EmbyCache().Get(ctx, u.Value().EmbyCache())
	if err != nil {
		return nil, err
	}
	if data.Name != "" {
		movie.Name = data.Name
	}
	movie.VideoRange = data.VideoRange

	for si, es := range data.Sources {
		if len(es.URL) == 0 {
			if si != len(data.Sources)-1 {
				continue
			}

			if movie.URL == "" {
				return nil, errors.New("no source")
			}
		}

		rawPath, err := url.JoinPath("/api/room/movie/proxy", movie.ID)
		if err != nil {
			return nil, err
		}

		rawQuery := url.Values{}
		rawQuery.Set("source", strconv.Itoa(si))
		rawQuery.Set("token", userToken)
		rawQuery.Set("roomId", movie.RoomID)
		u := url.URL{
			Path:     rawPath,
			RawQuery: rawQuery.Encode(),
		}

		if si == 0 {
			movie.URL = u.String()
			movie.Type = utils.GetURLExtension(es.URL)
			movie.PlaybackMode = playbackMode(es.IsTranscode)
		} else {
			movie.MoreSources = append(movie.MoreSources,
				&dbModel.MoreSource{
					Name:         es.Name,
					URL:          u.String(),
					Type:         utils.GetURLExtension(es.URL),
					PlaybackMode: playbackMode(es.IsTranscode),
				},
			)
		}

		if len(es.Subtitles) == 0 {
			continue
		}

		for sbi, s := range es.Subtitles {
			if movie.Subtitles == nil {
				movie.Subtitles = make(map[string]*dbModel.Subtitle, len(es.Subtitles))
			}

			rawQuery := url.Values{}
			rawQuery.Set("t", "subtitle")
			rawQuery.Set("source", strconv.Itoa(si))
			rawQuery.Set("id", strconv.Itoa(sbi))
			rawQuery.Set("token", userToken)
			rawQuery.Set("roomId", movie.RoomID)
			u := url.URL{
				Path:     rawPath,
				RawQuery: rawQuery.Encode(),
			}
			movie.Subtitles[s.Name] = s.Subtitle()
			movie.Subtitles[s.Name].URL = u.String()
		}
	}

	return movie, nil
}

// Report the media server's chosen route without changing its playback decision.
func playbackMode(transcode bool) string {
	if transcode {
		return "transcode"
	}
	return "direct"
}

// Each viewer's compatibility encoder gets a separate Jellyfin session. Seeking
// in one browser must not restart another browser's transcoding process.
func viewerSourceURL(raw string, compatibility bool) string {
	if !compatibility {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := u.Query()
	q.Set("PlaySessionId", utils.SortUUID())
	u.RawQuery = q.Encode()
	return u.String()
}
