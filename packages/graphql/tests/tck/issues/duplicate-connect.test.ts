/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Neo4jGraphQL } from "../../../src";
import { formatCypher, formatParams, translateQuery } from "../utils/tck-test-utils";

describe("issue/duplicate-connect", () => {
    let typeDefs: string;
    let neoSchema: Neo4jGraphQL;

    beforeAll(() => {
        typeDefs = /* GraphQL */ `
            type Movie @node {
                title: String!
                runtime: Int!
                actors: [Actor!]! @relationship(type: "ACTED_IN", direction: IN, properties: "ActedIn")
            }

            type ActedIn @relationshipProperties {
                screenTime: Int!
            }

            type Actor @node {
                name: String!
                actedIn: [Movie!]! @relationship(type: "ACTED_IN", direction: OUT, properties: "ActedIn")
            }
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
        });
    });

    test("update interface relationship, connect edge", async () => {
        const query = /* GraphQL */ `
            mutation {
                updateActors(
                    update: {
                        actedIn: [
                            {
                                where: { node: { title: { eq: "movie1" } } }
                                update: {
                                    node: {
                                        actors: [
                                            {
                                                connect: {
                                                    where: { node: { name: { eq: "anotherActor" } } }
                                                    edge: { screenTime: 111 }
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        ]
                    }
                ) {
                    actors {
                        name
                        actedInConnection {
                            edges {
                                node {
                                    title
                                }
                                properties {
                                    screenTime
                                }
                            }
                        }
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:Actor)
            WITH this
            CALL {
            	WITH this
            	MATCH (this)-[this_acted_in0_relationship:ACTED_IN]->(this_actedIn0:Movie)
            	WHERE this_actedIn0.title = $updateActors_args_update_actedIn0_where_this_actedIn0param0
            	WITH *
            	CALL {
            		WITH this, this_actedIn0
            		OPTIONAL MATCH (this_actedIn0_actors0_connect0_node:Actor)
            		WHERE this_actedIn0_actors0_connect0_node.name = $this_actedIn0_actors0_connect0_node_param0
            		CALL {
            			WITH *
            			WITH this, collect(this_actedIn0_actors0_connect0_node) as connectedNodes, collect(this_actedIn0) as parentNodes
            			CALL {
            				WITH connectedNodes, parentNodes
            				UNWIND parentNodes as this_actedIn0
            				UNWIND connectedNodes as this_actedIn0_actors0_connect0_node
            				CREATE (this_actedIn0)<-[this_actedIn0_actors0_connect0_relationship:ACTED_IN]-(this_actedIn0_actors0_connect0_node)
            				SET this_actedIn0_actors0_connect0_relationship.screenTime = $this_actedIn0_actors0_connect0_relationship_screenTime
            			}
            		}
            	WITH this, this_actedIn0, this_actedIn0_actors0_connect0_node
            		RETURN count(*) AS connect_this_actedIn0_actors0_connect_Actor0
            	}
            	RETURN count(*) AS update_this_actedIn0
            }
            WITH *
            CALL {
                WITH this
                MATCH (this)-[update_this0:ACTED_IN]->(update_this1:Movie)
                WITH collect({ node: update_this1, relationship: update_this0 }) AS edges
                WITH edges, size(edges) AS totalCount
                CALL {
                    WITH edges
                    UNWIND edges AS edge
                    WITH edge.node AS update_this1, edge.relationship AS update_this0
                    RETURN collect({ properties: { screenTime: update_this0.screenTime, __resolveType: \\"ActedIn\\" }, node: { title: update_this1.title, __resolveType: \\"Movie\\" } }) AS update_var2
                }
                RETURN { edges: update_var2, totalCount: totalCount } AS update_var3
            }
            RETURN collect(DISTINCT this { .name, actedInConnection: update_var3 }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"updateActors_args_update_actedIn0_where_this_actedIn0param0\\": \\"movie1\\",
                \\"this_actedIn0_actors0_connect0_node_param0\\": \\"anotherActor\\",
                \\"this_actedIn0_actors0_connect0_relationship_screenTime\\": {
                    \\"low\\": 111,
                    \\"high\\": 0
                },
                \\"updateActors\\": {
                    \\"args\\": {
                        \\"update\\": {
                            \\"actedIn\\": [
                                {
                                    \\"where\\": {
                                        \\"node\\": {
                                            \\"title\\": {
                                                \\"eq\\": \\"movie1\\"
                                            }
                                        }
                                    },
                                    \\"update\\": {
                                        \\"node\\": {
                                            \\"actors\\": [
                                                {
                                                    \\"connect\\": [
                                                        {
                                                            \\"edge\\": {
                                                                \\"screenTime\\": {
                                                                    \\"low\\": 111,
                                                                    \\"high\\": 0
                                                                }
                                                            },
                                                            \\"where\\": {
                                                                \\"node\\": {
                                                                    \\"name\\": {
                                                                        \\"eq\\": \\"anotherActor\\"
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });
});
