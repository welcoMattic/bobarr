import { Processor, Process, InjectQueue } from '@nestjs/bull';
import { forEachSeries } from 'p-iteration';
import { Job, Queue } from 'bull';

import {
  JobsQueue,
  FileType,
  DownloadableMediaState,
  DownloadQueueProcessors,
} from 'src/app.dto';

import { MovieDAO } from 'src/entities/dao/movie.dao';
import { TVSeasonDAO } from 'src/entities/dao/tvseason.dao';
import { TVEpisodeDAO } from 'src/entities/dao/tvepisode.dao';

import { JackettService } from 'src/modules/jackett/jackett.service';
import { TransmissionService } from 'src/modules/transmission/transmission.service';

@Processor(JobsQueue.DOWNLOAD)
export class DownloadProcessor {
  // eslint-disable-next-line max-params
  public constructor(
    @InjectQueue(JobsQueue.DOWNLOAD) private readonly downloadQueue: Queue,
    private readonly movieDAO: MovieDAO,
    private readonly tvSeasonDAO: TVSeasonDAO,
    private readonly tvEpisodeDAO: TVEpisodeDAO,
    private readonly jackettService: JackettService,
    private readonly transmissionService: TransmissionService
  ) {}

  @Process(DownloadQueueProcessors.DOWNLOAD_MOVIE)
  public async downloadMovie({ data: movieId }: Job<number>) {
    const [bestResult] = await this.jackettService.searchMovie(movieId);

    if (bestResult === undefined) {
      return this.downloadQueue.add(
        DownloadQueueProcessors.DOWNLOAD_MOVIE,
        movieId,
        { delay: 1000 * 60 * 60 } // retry in a hour
      );
    }

    const torrent = await this.transmissionService.addTorrentURL(
      bestResult.downloadLink,
      {
        resourceType: FileType.MOVIE,
        resourceId: movieId,
        quality: bestResult.quality.label,
        tag: bestResult.tag.label,
      }
    );

    await this.movieDAO.save({
      id: movieId,
      state: DownloadableMediaState.DOWNLOADING,
    });

    return torrent;
  }

  @Process(DownloadQueueProcessors.DOWNLOAD_SEASON)
  public async downloadSeason({ data: seasonId }: Job<number>) {
    const [bestResult] = await this.jackettService.searchSeason(seasonId);

    if (bestResult === undefined) {
      const season = await this.tvSeasonDAO.findOneOrFail({
        where: { id: seasonId },
        relations: ['episodes'],
      });

      return forEachSeries(season.episodes, (episode) =>
        this.downloadQueue.add(
          DownloadQueueProcessors.DOWNLOAD_EPISODE,
          episode.id
        )
      );
    }

    const torrent = await this.transmissionService.addTorrentURL(
      bestResult.downloadLink,
      {
        resourceType: FileType.SEASON,
        resourceId: seasonId,
        quality: bestResult.quality.label,
        tag: bestResult.tag.label,
      }
    );

    await this.tvSeasonDAO.save({
      id: seasonId,
      state: DownloadableMediaState.DOWNLOADING,
    });

    return torrent;
  }

  @Process(DownloadQueueProcessors.DOWNLOAD_EPISODE)
  public async downloadEpisode({ data: episodeId }: Job<number>) {
    const [bestResult] = await this.jackettService.searchEpisode(episodeId);

    if (bestResult === undefined) {
      return this.downloadQueue.add(
        DownloadQueueProcessors.DOWNLOAD_EPISODE,
        episodeId,
        { delay: 1000 * 60 * 60 } // retry in a hour
      );
    }

    const torrent = await this.transmissionService.addTorrentURL(
      bestResult.downloadLink,
      {
        resourceType: FileType.EPISODE,
        resourceId: episodeId,
        quality: bestResult.quality.label,
        tag: bestResult.tag.label,
      }
    );

    await this.tvEpisodeDAO.save({
      id: episodeId,
      state: DownloadableMediaState.DOWNLOADING,
    });

    return torrent;
  }
}
