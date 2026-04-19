/**
 * Validates if a string is a valid UUID v4 format.
 * @param {string} id 
 * @returns {boolean}
 */
export const isUuid = (id) => {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};
