import type { AppComponents } from '../../types'
import type { FavoriteCommand, IInteractionsComponent, LikeCommand } from './types'

/**
 * Shared like/favorite orchestration for any entity (place, world, or event).
 * Each command opens a transaction so the interaction row and the entity's
 * denormalized aggregates (Wilson like_score / favorites count) always move
 * together. Snapshot voting-power weighting is supplied by the caller via
 * `userActivity` (fetched through the snapshot adapter once it lands).
 */
export async function createInteractionsComponent(
  components: Pick<AppComponents, 'pg' | 'interactionsRepository' | 'logs'>
): Promise<IInteractionsComponent> {
  const { pg, interactionsRepository } = components

  async function setLike(command: LikeCommand): Promise<void> {
    const userActivity = command.userActivity ?? 0
    await pg.withTransaction(async (tx) => {
      await interactionsRepository.setLike(tx, {
        entityId: command.entityId,
        entityType: command.entityType,
        user: command.user,
        userActivity,
        like: command.like
      })
      await interactionsRepository.recomputeLikes(tx, command.entityType, command.entityId)
    })
  }

  async function setFavorite(command: FavoriteCommand): Promise<void> {
    const userActivity = command.userActivity ?? 0
    await pg.withTransaction(async (tx) => {
      await interactionsRepository.setFavorite(tx, {
        entityId: command.entityId,
        entityType: command.entityType,
        user: command.user,
        userActivity,
        favorite: command.favorite
      })
      await interactionsRepository.recomputeFavorites(tx, command.entityType, command.entityId)
    })
  }

  return { setLike, setFavorite }
}
