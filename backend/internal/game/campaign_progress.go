package game

import "context"

type CampaignProgress struct {
	Current   int `json:"current"`
	Position  int `json:"position"`
	Total     int `json:"total"`
	Completed int `json:"completed"`
}

func (s *Service) CampaignProgress(ctx context.Context, user string) (map[string]CampaignProgress, error) {
	result := map[string]CampaignProgress{"classic": {}, "quartet": {}, "fun": {}}
	lastOrdinal := map[string]int{}
	rows, err := s.Q.ListCampaignProgressLevels(ctx, user)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		progress, ok := result[row.Mode]
		if !ok {
			continue
		}
		progress.Total++
		lastOrdinal[row.Mode] = int(row.Ordinal)
		if row.Completed {
			progress.Completed++
		} else if progress.Current == 0 {
			progress.Current = int(row.Ordinal)
			progress.Position = progress.Total
		}
		result[row.Mode] = progress
	}
	for mode, progress := range result {
		if progress.Current == 0 && progress.Total > 0 {
			progress.Current = lastOrdinal[mode]
			progress.Position = progress.Total
		}
		result[mode] = progress
	}
	return result, nil
}
